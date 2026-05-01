import asyncio

import jwt
from fastapi import HTTPException, status

from app.config import settings

_jwks_client: jwt.PyJWKClient | None = None

_JWKS_CACHE_LIFESPAN = 86_400  # 24 hours


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            settings.clerk_jwks_url,
            cache_keys=True,
            lifespan=_JWKS_CACHE_LIFESPAN,
        )
    return _jwks_client


def _sync_verify(token: str) -> dict[str, object]:
    """Blocking — run in a thread pool via run_in_executor."""
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(  # type: ignore[no-any-return]
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False},
    )


async def verify_clerk_jwt(token: str) -> tuple[str, str]:
    """
    Verify a Clerk JWT and return (clerk_user_id, email).

    Email is "" when not present in claims (Clerk doesn't include it by default;
    enable via a custom session token template in the Clerk dashboard).
    """
    if not settings.clerk_jwks_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth not configured",
        )
    try:
        loop = asyncio.get_running_loop()
        payload = await loop.run_in_executor(None, _sync_verify, token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token verification failed",
        )

    clerk_user_id: str = str(payload["sub"])
    email: str = str(payload.get("email", ""))
    return clerk_user_id, email
