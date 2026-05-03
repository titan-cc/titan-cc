import asyncio
import urllib.parse
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import sentry_sdk
import structlog
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.deps import get_current_user
from app.models import User
from app.routers import admin, internal, jobs, notifications, system, uploads, webhooks
from app.schemas import UserMeResponse
from app.services.dispatcher import run_dispatcher
from app.services.watchdog import run_watchdog

logger = structlog.get_logger()

# AWS query-param names that carry signing credentials in presigned URLs.
_AWS_SENSITIVE_PARAMS = frozenset({
    "x-amz-signature",
    "x-amz-credential",
    "x-amz-security-token",
    "x-amz-algorithm",
    "x-amz-date",
    "x-amz-expires",
    "x-amz-signedheaders",
})


def _scrub_url(value: str) -> str:
    """Replace sensitive AWS query-param values with [REDACTED]."""
    try:
        parsed = urllib.parse.urlparse(value)
        if not parsed.query or "X-Amz-" not in parsed.query:
            return value
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        scrubbed = {
            k: (["[REDACTED]"] if k.lower() in _AWS_SENSITIVE_PARAMS else v)
            for k, v in params.items()
        }
        return urllib.parse.urlunparse(
            parsed._replace(query=urllib.parse.urlencode(scrubbed, doseq=True))
        )
    except Exception:
        return "[URL_SCRUBBED]"


def _walk_and_scrub(obj: Any) -> Any:
    """Recursively scrub AWS credentials from all strings in a Sentry event."""
    if isinstance(obj, str):
        return _scrub_url(obj) if "X-Amz-" in obj else obj
    if isinstance(obj, dict):
        return {k: _walk_and_scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_walk_and_scrub(i) for i in obj]
    return obj


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    """Scrub AWS presigned URL credentials from all Sentry event data."""
    return _walk_and_scrub(event)  # type: ignore[return-value]


if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,   # never attach user IP / cookies
        before_send=_before_send, # strip X-Amz-* params from captured locals/URLs
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    tasks: list[asyncio.Task] = []
    if settings.runpod_endpoint_url:
        tasks.append(asyncio.create_task(run_dispatcher()))
        tasks.append(asyncio.create_task(run_watchdog()))
        logger.info("background_tasks_started")
    else:
        logger.warning("dispatcher_disabled", reason="RUNPOD_ENDPOINT_URL not set")
    yield
    for task in tasks:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Titan CC API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/system", tags=["system"])
app.include_router(uploads.router, prefix="/uploads", tags=["uploads"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
app.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(internal.router, prefix="/internal", tags=["internal"])


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/users/me", response_model=UserMeResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    return user
