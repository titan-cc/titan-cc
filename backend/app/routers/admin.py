import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db import get_db
from app.deps import require_admin
from app.models import Job, Quota, User
from app.schemas import (
    AdminJobListResponse,
    AdminJobResponse,
    AdminUserListResponse,
    AdminUserResponse,
    BillingLineItem,
    BillingResponse,
    ProviderBilling,
    QuotaResponse,
    UpdateUserRequest,
)

logger = structlog.get_logger()

router = APIRouter()

VALID_ROLES = {"user", "admin"}
VALID_ACCESS_LEVELS = {"basic", "standard", "pro", "enterprise"}

ACCESS_LEVEL_PRESETS: dict[str, dict[str, int]] = {
    "basic":      {"max_concurrent_jobs": 2,  "max_minutes_per_month": 300,  "max_duration_seconds": 7_200},
    "standard":   {"max_concurrent_jobs": 3,  "max_minutes_per_month": 600,  "max_duration_seconds": 7_200},
    "pro":        {"max_concurrent_jobs": 5,  "max_minutes_per_month": 1_200, "max_duration_seconds": 14_400},
    "enterprise": {"max_concurrent_jobs": 10, "max_minutes_per_month": 5_000, "max_duration_seconds": 28_800},
}

# Simple TTL cache: key → (fetched_at, data)
_billing_cache: dict[str, tuple[float, Any]] = {}
_BILLING_TTL = 300.0  # 5 minutes


def _billing_period() -> str:
    return datetime.now(UTC).strftime("%B %Y")


# ── User management helpers ───────────────────────────────────────────────────

def _build_user_response(user: User, job_count: int) -> AdminUserResponse:
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        plan=user.plan,
        role=user.role,
        is_enabled=user.is_enabled,
        access_level=user.access_level,
        created_at=user.created_at,
        quota=QuotaResponse.model_validate(user.quota) if user.quota else None,
        job_count=job_count,
    )


# ── Billing fetchers ──────────────────────────────────────────────────────────

async def _fetch_runpod() -> ProviderBilling:
    period = _billing_period()
    if not settings.runpod_api_key:
        return ProviderBilling(provider="runpod", period=period, error="RUNPOD_API_KEY not configured")

    query = """
    {
      myself {
        clientBalance
        spendLimit
        currentSpendPerHr
        serverlessDiscount { discountFactor }
      }
    }
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"https://api.runpod.io/graphql?api_key={settings.runpod_api_key}",
                json={"query": query},
            )
            r.raise_for_status()
            data = r.json()

        if data.get("errors"):
            err_msg = data["errors"][0].get("message", "GraphQL error")
            return ProviderBilling(provider="runpod", period=period, error=err_msg)

        myself = data.get("data", {}).get("myself") or {}
        credit_balance = float(myself.get("clientBalance") or 0)
        spend_limit = float(myself.get("spendLimit") or 0)
        current_per_hr = float(myself.get("currentSpendPerHr") or 0)
        discount = myself.get("serverlessDiscount") or {}
        discount_pct = round((1 - float(discount.get("discountFactor") or 1)) * 100)

        items = [
            BillingLineItem(label="Credit balance", amount_usd=credit_balance),
            BillingLineItem(label="Spend limit", amount_usd=spend_limit),
        ]
        meta: dict[str, Any] = {
            "spend_rate_per_hr": current_per_hr,
            "spend_rate_label": f"${current_per_hr:.4f}/hr",
        }
        if discount_pct:
            meta["discount"] = f"{discount_pct}% serverless discount active"

        return ProviderBilling(
            provider="runpod",
            period=period,
            total_usd=credit_balance,
            items=items,
            meta=meta,
        )
    except Exception as exc:
        logger.warning("billing_runpod_error", error=str(exc))
        return ProviderBilling(provider="runpod", period=period, error=str(exc))


async def _fetch_railway() -> ProviderBilling:
    period = _billing_period()
    if not settings.railway_api_token:
        return ProviderBilling(provider="railway", period=period, error="RAILWAY_API_TOKEN not configured")

    # Query current team usage + project list
    query = """
    {
      me {
        usage {
          current { estimatedCost }
          estimated { estimatedCost }
        }
        projects {
          edges {
            node {
              id
              name
              usage {
                current { estimatedCost }
                estimated { estimatedCost }
              }
            }
          }
        }
      }
    }
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://backboard.railway.app/graphql/v2",
                headers={
                    "Authorization": f"Bearer {settings.railway_api_token}",
                    "Content-Type": "application/json",
                },
                json={"query": query},
            )
            r.raise_for_status()
            data = r.json()

        errors = data.get("errors")
        if errors:
            return ProviderBilling(provider="railway", period=period, error=errors[0].get("message", "API error"))

        me = data.get("data", {}).get("me") or {}
        top_usage = me.get("usage") or {}
        estimated_cost = top_usage.get("estimated", {}).get("estimatedCost") or \
                         top_usage.get("current", {}).get("estimatedCost")
        total = float(estimated_cost) if estimated_cost is not None else None

        # Per-project breakdown
        items: list[BillingLineItem] = []
        for edge in (me.get("projects", {}).get("edges") or []):
            node = edge.get("node") or {}
            proj_usage = node.get("usage") or {}
            cost_val = (proj_usage.get("estimated") or {}).get("estimatedCost") or \
                       (proj_usage.get("current") or {}).get("estimatedCost")
            if cost_val is not None:
                items.append(BillingLineItem(label=node.get("name", "project"), amount_usd=float(cost_val)))

        # If no top-level total but we have items, sum them
        if total is None and items:
            total = sum(i.amount_usd for i in items)

        return ProviderBilling(provider="railway", period=period, total_usd=total, items=items)
    except Exception as exc:
        logger.warning("billing_railway_error", error=str(exc))
        return ProviderBilling(provider="railway", period=period, error=str(exc))


async def _fetch_aws() -> ProviderBilling:
    period = _billing_period()
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        return ProviderBilling(provider="aws", period=period, error="AWS credentials not configured")

    def _sync_fetch() -> ProviderBilling:
        now = datetime.now(UTC)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # Cost Explorer end date is exclusive; must be > start
        end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        if end <= start:
            end = start + timedelta(days=1)

        client = boto3.client(
            "ce",
            region_name="us-east-1",  # Cost Explorer is us-east-1 only
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        resp = client.get_cost_and_usage(
            TimePeriod={"Start": start.strftime("%Y-%m-%d"), "End": end.strftime("%Y-%m-%d")},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "SERVICE", "Key": "SERVICE"}],
        )

        items: list[BillingLineItem] = []
        total = 0.0
        for group in resp.get("ResultsByTime", [{}])[0].get("Groups", []):
            label = group["Keys"][0]
            amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
            if amount > 0:
                items.append(BillingLineItem(label=label, amount_usd=amount))
                total += amount

        items.sort(key=lambda x: x.amount_usd, reverse=True)
        return ProviderBilling(provider="aws", period=period, total_usd=total, items=items)

    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _sync_fetch)
    except Exception as exc:
        logger.warning("billing_aws_error", error=str(exc))
        return ProviderBilling(provider="aws", period=period, error=str(exc))


# ── User management endpoints ─────────────────────────────────────────────────

@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    cursor: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=100),
    search: str | None = None,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Any:
    q = (
        select(User)
        .options(selectinload(User.quota))
        .order_by(User.created_at.desc())
    )

    if search:
        q = q.where(User.email.ilike(f"%{search}%"))

    if cursor:
        cursor_result = await db.execute(select(User.created_at).where(User.id == cursor))
        cursor_ts = cursor_result.scalar_one_or_none()
        if cursor_ts:
            q = q.where(User.created_at < cursor_ts)

    q = q.limit(limit + 1)
    result = await db.execute(q)
    users = list(result.scalars().all())

    has_more = len(users) > limit
    users = users[:limit]

    if users:
        user_ids = [u.id for u in users]
        counts_result = await db.execute(
            select(Job.user_id, func.count(Job.id))
            .where(Job.user_id.in_(user_ids))
            .group_by(Job.user_id)
        )
        job_counts: dict[uuid.UUID, int] = {row[0]: row[1] for row in counts_result}
    else:
        job_counts = {}

    users_out = [_build_user_response(u, job_counts.get(u.id, 0)) for u in users]
    next_cursor = users[-1].id if has_more and users else None
    return AdminUserListResponse(users=users_out, next_cursor=next_cursor)


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Any:
    result = await db.execute(
        select(User).options(selectinload(User.quota)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    is_self = user.id == admin.id

    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=422, detail=f"role must be one of {VALID_ROLES}")
        if is_self and body.role != "admin":
            raise HTTPException(status_code=422, detail="You cannot remove your own admin role")
        user.role = body.role

    if body.is_enabled is not None:
        if is_self and not body.is_enabled:
            raise HTTPException(status_code=422, detail="You cannot disable your own account")
        user.is_enabled = body.is_enabled

    if body.access_level is not None:
        if body.access_level not in VALID_ACCESS_LEVELS:
            raise HTTPException(status_code=422, detail=f"access_level must be one of {VALID_ACCESS_LEVELS}")
        user.access_level = body.access_level
        preset = ACCESS_LEVEL_PRESETS[body.access_level]
        if user.quota:
            user.quota.max_concurrent_jobs = preset["max_concurrent_jobs"]
            user.quota.max_minutes_per_month = preset["max_minutes_per_month"]
            user.quota.max_duration_seconds = preset["max_duration_seconds"]

    await db.commit()
    await db.refresh(user)
    if user.quota:
        await db.refresh(user.quota)

    count_result = await db.execute(select(func.count(Job.id)).where(Job.user_id == user_id))
    job_count = count_result.scalar() or 0

    logger.info("admin_updated_user", admin_id=str(admin.id), target_user_id=str(user_id))
    return _build_user_response(user, job_count)


@router.post("/users/{user_id}/quota/refresh", response_model=QuotaResponse)
async def refresh_quota(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Any:
    result = await db.execute(select(Quota).where(Quota.user_id == user_id))
    quota = result.scalar_one_or_none()
    if not quota:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    now = datetime.now(UTC)
    quota.minutes_used_this_month = 0
    quota.quota_reset_at = (now.replace(day=1) + timedelta(days=32)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    await db.commit()
    await db.refresh(quota)

    logger.info("admin_refreshed_quota", admin_id=str(admin.id), target_user_id=str(user_id))
    return QuotaResponse.model_validate(quota)


# ── Billing endpoint ──────────────────────────────────────────────────────────

@router.get("/billing", response_model=BillingResponse)
async def get_billing(
    refresh: bool = False,
    admin: User = Depends(require_admin),
) -> Any:
    cache_key = "billing"
    if not refresh and cache_key in _billing_cache:
        fetched_at, cached = _billing_cache[cache_key]
        if time.monotonic() - fetched_at < _BILLING_TTL:
            return cached

    runpod, railway, aws = await asyncio.gather(
        _fetch_runpod(),
        _fetch_railway(),
        _fetch_aws(),
    )

    result = BillingResponse(
        period=_billing_period(),
        runpod=runpod,
        railway=railway,
        aws=aws,
    )
    _billing_cache[cache_key] = (time.monotonic(), result)
    return result


@router.get("/jobs", response_model=AdminJobListResponse)
async def list_all_jobs(
    cursor: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Any:
    from app.models import JobStatus
    q = (
        select(Job, User.email.label("user_email"))
        .join(User, Job.user_id == User.id)
        .order_by(Job.created_at.desc())
    )

    if status_filter:
        try:
            q = q.where(Job.status == JobStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status_filter}")

    if cursor:
        cursor_result = await db.execute(select(Job.created_at).where(Job.id == cursor))
        cursor_ts = cursor_result.scalar_one_or_none()
        if cursor_ts:
            q = q.where(Job.created_at < cursor_ts)

    q = q.limit(limit + 1)
    result = await db.execute(q)
    rows = result.all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    from app.schemas import JobResponse
    jobs_out = [
        AdminJobResponse(**JobResponse.model_validate(row.Job).model_dump(), user_email=row.user_email)
        for row in rows
    ]
    next_cursor = rows[-1].Job.id if has_more and rows else None
    return AdminJobListResponse(jobs=jobs_out, next_cursor=next_cursor)


@router.post("/jobs/reset-dispatched")
async def reset_stuck_dispatched_jobs(
    older_than_minutes: int = Query(default=5, ge=1, le=120),
    x_admin_key: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if x_admin_key != settings.runpod_webhook_secret:
        raise HTTPException(status_code=403, detail="Forbidden")
    """Reset dispatched jobs stuck for longer than older_than_minutes back to queued."""
    from app.models import JobEvent, JobStatus
    cutoff = datetime.now(UTC) - timedelta(minutes=older_than_minutes)
    result = await db.execute(
        select(Job).where(
            Job.status == JobStatus.dispatched,
            Job.dispatched_at < cutoff,
        )
    )
    jobs = result.scalars().all()
    runpod_ids = [j.runpod_job_id for j in jobs if j.runpod_job_id]
    for job in jobs:
        job.status = JobStatus.queued
        job.claim_token = None
        job.runpod_job_id = None
        job.dispatched_at = None
        job.updated_at = datetime.now(UTC)
        db.add(JobEvent(
            job_id=job.id,
            event_type="admin_reset",
            from_status=JobStatus.dispatched,
            to_status=JobStatus.queued,
        ))
    await db.commit()

    if runpod_ids:
        from app.services.runpod import cancel_runpod_job
        await asyncio.gather(*[cancel_runpod_job(rid) for rid in runpod_ids], return_exceptions=True)

    logger.info("admin_reset_dispatched", count=len(jobs))
    return {"reset": len(jobs), "job_ids": [str(j.id) for j in jobs]}
