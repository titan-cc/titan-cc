"""System endpoints — worker health and warmup."""

from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.models import User
from app.schemas import WarmupResponse, WorkerStatusResponse
from app.services.runpod import get_endpoint_health, submit_warmup_job

router = APIRouter()


@router.get("/worker-status", response_model=WorkerStatusResponse)
async def worker_status(_: User = Depends(get_current_user)) -> WorkerStatusResponse:
    health = await get_endpoint_health()
    workers = health.get("workers", {})
    idle = workers.get("idle", 0)
    running = workers.get("running", 0)
    return WorkerStatusResponse(
        warm=idle > 0 or running > 0,
        idle_workers=idle,
        running_workers=running,
    )


@router.post("/warmup", response_model=WarmupResponse)
async def warmup_worker(_: User = Depends(get_current_user)) -> WarmupResponse:
    health = await get_endpoint_health()
    workers = health.get("workers", {})
    if workers.get("idle", 0) > 0 or workers.get("running", 0) > 0:
        return WarmupResponse(already_warm=True, message="Worker is already warm.")
    await submit_warmup_job()
    return WarmupResponse(already_warm=False, message="Warming up…")
