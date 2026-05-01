import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import require_admin
from app.models import Job, Quota, User
from app.schemas import (
    AdminUserListResponse,
    AdminUserResponse,
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


def _build_response(user: User, job_count: int) -> AdminUserResponse:
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

    users_out = [_build_response(u, job_counts.get(u.id, 0)) for u in users]
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

    # Prevent self-demotion / self-disable
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

    count_result = await db.execute(
        select(func.count(Job.id)).where(Job.user_id == user_id)
    )
    job_count = count_result.scalar() or 0

    logger.info("admin_updated_user", admin_id=str(admin.id), target_user_id=str(user_id))
    return _build_response(user, job_count)


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
