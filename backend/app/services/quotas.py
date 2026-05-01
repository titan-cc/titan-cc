import math
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, JobStatus, Quota


def _advance_reset_date(reset_at: datetime) -> datetime:
    """Return the next month boundary strictly after now."""
    now = datetime.now(UTC)
    candidate = reset_at
    while candidate <= now:
        candidate = (candidate.replace(day=1) + timedelta(days=32)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
    return candidate


async def check_quota(quota: Quota, duration_seconds: int, db: AsyncSession) -> None:
    """Auto-reset if past monthly boundary, then enforce duration + monthly limits."""
    now = datetime.now(UTC)

    # Auto-reset monthly quota when the reset date has passed
    if now >= quota.quota_reset_at:
        quota.minutes_used_this_month = 0
        quota.quota_reset_at = _advance_reset_date(quota.quota_reset_at)
        db.add(quota)
        await db.flush()

    if duration_seconds > quota.max_duration_seconds:
        max_min = quota.max_duration_seconds // 60
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"File too long: max {max_min} minutes per job.",
        )

    minutes = math.ceil(duration_seconds / 60)
    remaining = quota.max_minutes_per_month - quota.minutes_used_this_month
    if minutes > remaining:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Monthly quota exceeded: {remaining} minutes remaining this month.",
        )


async def check_concurrent(quota: Quota, user_id: uuid.UUID, db: AsyncSession) -> None:
    """Reject if user already has max_concurrent_jobs active jobs."""
    active = (
        await db.execute(
            select(func.count(Job.id)).where(
                Job.user_id == user_id,
                Job.status.in_([JobStatus.queued, JobStatus.dispatched, JobStatus.processing]),
            )
        )
    ).scalar_one()

    if active >= quota.max_concurrent_jobs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Concurrent job limit reached ({quota.max_concurrent_jobs} active jobs max).",
        )
