"""Activity logging service — fire-and-append helper used across all routers."""

import uuid
from datetime import UTC, datetime, timedelta

import structlog

from app.models import UserActivityLog

logger = structlog.get_logger()

# Module-level dedupe cache so login events are logged at most once per hour
# per user (process-scoped; resets on restart, which is acceptable).
_login_cache: dict[str, datetime] = {}
_LOGIN_DEDUPE_MINUTES = 60


async def log_activity(
    db,  # AsyncSession — untyped to avoid circular import
    user_id: uuid.UUID | None,
    event_type: str,
    *,
    actor_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> None:
    """Append an activity row.  Never raises — failures are swallowed and logged."""
    try:
        db.add(
            UserActivityLog(
                user_id=user_id,
                actor_id=actor_id,
                event_type=event_type,
                metadata_=metadata,
            )
        )
    except Exception as exc:
        logger.warning("activity_log_error", event_type=event_type, error=str(exc))


async def log_login(
    db,
    user_id: uuid.UUID,
    *,
    is_new_user: bool = False,
) -> None:
    """Log a login/signup event with hourly deduplication for returning users."""
    key = str(user_id)
    now = datetime.now(UTC)

    if not is_new_user:
        last = _login_cache.get(key)
        if last and (now - last) < timedelta(minutes=_LOGIN_DEDUPE_MINUTES):
            return

    _login_cache[key] = now
    event_type = "user_signup" if is_new_user else "user_login"
    await log_activity(db, user_id, event_type)
