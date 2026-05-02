import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

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

if settings.sentry_dsn:
    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.app_env)


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
