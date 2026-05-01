"""
Phase 2 auth tests.

Three tiers:
  1. No Authorization header  → 403  (HTTPBearer rejects before our code runs)
  2. Malformed JWT             → 401  (verify_clerk_jwt raises; JWKS not fetched)
  3. Authenticated client      → 200  (dependency override; no real Clerk JWT needed)
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


async def test_me_no_auth_header(client: AsyncClient) -> None:
    resp = await client.get("/users/me")
    # HTTPBearer returns 401 when no Authorization header is present
    assert resp.status_code == 401


async def test_me_malformed_token_returns_401(client: AsyncClient) -> None:
    # "notajwt" cannot be decoded as a JWT header, so PyJWT raises
    # InvalidTokenError before any network call is made.
    resp = await client.get("/users/me", headers={"Authorization": "Bearer notajwt"})
    assert resp.status_code == 401


async def test_me_expired_token_returns_401(client: AsyncClient) -> None:
    from fastapi import HTTPException

    with patch("app.deps.verify_clerk_jwt", new_callable=AsyncMock) as mock_verify:
        mock_verify.side_effect = HTTPException(status_code=401, detail="Token expired")
        resp = await client.get("/users/me", headers={"Authorization": "Bearer expired.token"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Token expired"


async def test_me_returns_user_and_quota(auth_client: AsyncClient) -> None:
    resp = await auth_client.get("/users/me")
    assert resp.status_code == 200

    data = resp.json()
    assert data["email"] == "test@example.com"
    assert data["plan"] == "free"
    assert data["quota"] is not None
    assert data["quota"]["max_concurrent_jobs"] == 2
    assert data["quota"]["max_minutes_per_month"] == 300
    assert data["quota"]["minutes_used_this_month"] == 0
