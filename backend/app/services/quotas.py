import math

from fastapi import HTTPException, status

from app.models import Quota


def check_quota(quota: Quota, duration_seconds: int) -> None:
    """Raise 422 if the requested duration would violate per-job or monthly limits."""
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
