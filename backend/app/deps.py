from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import Depends, HTTPException, Security, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import verify_clerk_jwt
from app.config import settings
from app.db import get_db
from app.models import Quota, User

bearer_scheme = HTTPBearer()


async def _fetch_email_from_clerk(clerk_user_id: str) -> str:
    """Fetch primary email from Clerk Users API when not present in JWT."""
    if not settings.clerk_secret_key:
        return ""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"https://api.clerk.com/v1/users/{clerk_user_id}",
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            )
            if r.status_code == 200:
                data = r.json()
                primary_id = data.get("primary_email_address_id")
                for ea in data.get("email_addresses", []):
                    if ea.get("id") == primary_id:
                        return ea.get("email_address", "")
                emails = data.get("email_addresses", [])
                if emails:
                    return emails[0].get("email_address", "")
    except Exception:
        pass
    return ""


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
        # New user — fetch email from Clerk API if JWT didn't include it.
        if not email:
            email = await _fetch_email_from_clerk(clerk_user_id)
        user = await _create_user(db, clerk_user_id, email)
    else:
        dirty = False
        # Resolve email: JWT → DB → Clerk API (once, then cached in DB).
        effective_email = email or user.email
        if not effective_email:
            effective_email = await _fetch_email_from_clerk(clerk_user_id)
            if effective_email:
                user.email = effective_email
                dirty = True
        elif email and not user.email:
            user.email = email
            dirty = True

        # Promote existing users in ADMIN_EMAILS who haven't been promoted yet.
        if (
            effective_email
            and user.role != "admin"
            and effective_email.lower() in [e.lower() for e in settings.admin_emails]
        ):
            user.role = "admin"
            dirty = True

        if dirty:
            await db.commit()
            await db.refresh(user)

    if not user.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been disabled. Contact support.",
        )

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user


async def _create_user(db: AsyncSession, clerk_user_id: str, email: str) -> User:
    now = datetime.now(UTC)
    quota_reset_at = (now.replace(day=1) + timedelta(days=32)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )

    role = "admin" if email.lower() in [e.lower() for e in settings.admin_emails] else "user"

    try:
        user = User(clerk_user_id=clerk_user_id, email=email, role=role)
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
