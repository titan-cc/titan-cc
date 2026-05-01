from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.deps import get_current_user, get_db
from app.models import Notification, User
from app.schemas import NotificationListResponse

router = APIRouter()


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    unread: bool = False,
    limit: int = 20,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationListResponse:
    limit = min(max(1, limit), 100)
    q = select(Notification).where(Notification.user_id == user.id)
    if unread:
        q = q.where(Notification.read_at.is_(None))
    q = q.order_by(Notification.created_at.desc()).limit(limit)
    result = await db.execute(q)
    notifications = list(result.scalars())
    return NotificationListResponse(notifications=notifications)


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if notif is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if notif.read_at is None:
        notif.read_at = datetime.now(UTC)
        await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_notifications_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    )
    unread = result.scalars().all()
    now = datetime.now(UTC)
    for n in unread:
        n.read_at = now
    if unread:
        await db.commit()
    return {"ok": True}
