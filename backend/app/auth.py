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


def _expected_issuer() -> str | None:
    """
    Return the expected `iss` claim value.

    Prefers the explicit CLERK_ISSUER env var.  Falls back to stripping
    '/.well-known/jwks.json' from the JWKS URL so operators only need to
    set one value.  Returns None when neither is configured (dev shortcut;
    issuer check is skipped but a warning should be logged upstream).
    """
    if settings.clerk_issuer:
        return settings.clerk_issuer
    if settings.clerk_jwks_url:
        return settings.clerk_jwks_url.removesuffix("/.well-known/jwks.json")
    return None


def _sync_verify(token: str) -> dict[str, object]:
    """Blocking — run in a thread pool via run_in_executor."""
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)

    decode_kwargs: dict[str, object] = {
        "algorithms": ["RS256"],
        # Clerk does not set `aud` in default session tokens; skip that check.
        # Tenant-scoping is enforced via `issuer` below, and per-app scoping
        # is enforced via the `azp` check in verify_clerk_jwt().
        "options": {"verify_aud": False},
    }
    issuer = _expected_issuer()
    if issuer:
        decode_kwargs["issuer"] = issuer

    return jwt.decode(token, signing_key.key, **decode_kwargs)  # type: ignore[no-any-return]


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

    # Verify azp (authorized party) is one of our known frontend origins.
    # Clerk sets azp to the origin that minted the session token, so this
    # ensures tokens from unrelated Clerk apps are rejected even if they share
    # the same tenant or happen to pass signature verification.
    azp: str = str(payload.get("azp", ""))
    if azp and azp not in settings.cors_origins:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token not authorized for this application",
        )

    clerk_user_id: str = str(payload["sub"])
    email: str = str(payload.get("email", ""))
    return clerk_user_id, email
