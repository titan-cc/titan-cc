import uuid
from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.deps import get_current_user
from app.main import app


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_fake_user() -> SimpleNamespace:
    """Return a SimpleNamespace that Pydantic's from_attributes serializer can read."""
    quota = SimpleNamespace(
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        max_concurrent_jobs=2,
        max_minutes_per_month=300,
        max_duration_seconds=7200,
        minutes_used_this_month=0,
        quota_reset_at=datetime(2026, 5, 1, tzinfo=UTC),
    )
    return SimpleNamespace(
        id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        clerk_user_id="user_test123",
        email="test@example.com",
        plan="free",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        quota=quota,
    )


@pytest.fixture
def auth_client(client: AsyncClient) -> Generator[AsyncClient, None, None]:
    """AsyncClient whose get_current_user dependency is overridden with a fake user.
    Use for endpoint tests that need an authenticated context without a real DB.
    """
    fake_user = _make_fake_user()
    app.dependency_overrides[get_current_user] = lambda: fake_user
    yield client  # type: ignore[misc]
    del app.dependency_overrides[get_current_user]
