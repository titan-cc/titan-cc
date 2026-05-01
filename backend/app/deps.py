from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Security, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import verify_clerk_jwt
from app.db import get_db
from app.models import Quota, User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    clerk_user_id, email = await verify_clerk_jwt(token)

    result = await db.execute(
        select(User)
        .options(selectinload(User.quota))
        .where(User.clerk_user_id == clerk_user_id)
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = await _create_user(db, clerk_user_id, email)
    elif email and not user.email:
        user.email = email
        await db.commit()
        await db.refresh(user)

    return user


async def _create_user(db: AsyncSession, clerk_user_id: str, email: str) -> User:
    now = datetime.now(UTC)
    quota_reset_at = (now.replace(day=1) + timedelta(days=32)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )

    try:
        user = User(clerk_user_id=clerk_user_id, email=email)
        db.add(user)
        await db.flush()
        db.add(Quota(user_id=user.id, quota_reset_at=quota_reset_at))
        await db.commit()
    except IntegrityError:
        # Race condition: another concurrent request already created this user.
        await db.rollback()
        result = await db.execute(
            select(User)
            .options(selectinload(User.quota))
            .where(User.clerk_user_id == clerk_user_id)
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create user",
            )
        return user

    result = await db.execute(
        select(User)
        .options(selectinload(User.quota))
        .where(User.id == user.id)
    )
    return result.scalar_one()


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db():
        yield session
