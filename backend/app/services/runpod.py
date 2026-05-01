"""RunPod API client — dispatches and cancels jobs on the configured endpoint."""

import uuid

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

_BASE = "https://api.runpod.io/v2"


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if settings.runpod_api_key:
        h["Authorization"] = f"Bearer {settings.runpod_api_key}"
    return h


async def dispatch_job(
    job_id: uuid.UUID,
    claim_token: uuid.UUID,
    s3_key: str,
    config: dict,
) -> str | None:
    """POST a job to RunPod. Returns the RunPod job ID on success, None on error."""
    payload = {
        "input": {
            "job_id": str(job_id),
            "claim_token": str(claim_token),
            "s3_key": s3_key,
            "config": config,
            "webhook_url": f"{settings.api_base_url}/webhooks/runpod",
            "webhook_secret": settings.runpod_webhook_secret,
        }
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                settings.runpod_endpoint_url, json=payload, headers=_headers()
            )
            resp.raise_for_status()
            runpod_job_id: str = resp.json()["id"]
        logger.info("job_dispatched", job_id=str(job_id), runpod_job_id=runpod_job_id)
        return runpod_job_id
    except Exception as exc:
        logger.error("dispatch_failed", job_id=str(job_id), error=str(exc))
        return None


async def get_endpoint_health() -> dict:
    """Return RunPod endpoint health (worker counts). Returns zeros on any error."""
    if not settings.runpod_endpoint_id:
        return {"workers": {"idle": 0, "running": 0}}
    url = f"{_BASE}/{settings.runpod_endpoint_id}/health"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("health_check_failed", error=str(exc))
        return {"workers": {"idle": 0, "running": 0}}


async def submit_warmup_job() -> str | None:
    """Submit a no-op warmup ping to RunPod to trigger cold start. Returns job ID."""
    if not settings.runpod_endpoint_url:
        return None
    payload = {"input": {"type": "warmup"}}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                settings.runpod_endpoint_url, json=payload, headers=_headers()
            )
            resp.raise_for_status()
            job_id: str = resp.json()["id"]
        logger.info("warmup_dispatched", runpod_job_id=job_id)
        return job_id
    except Exception as exc:
        logger.warning("warmup_dispatch_failed", error=str(exc))
        return None


async def cancel_runpod_job(runpod_job_id: str) -> None:
    """Cancel a RunPod job. Best-effort — errors are logged, not raised."""
    if not settings.runpod_endpoint_id:
        return
    url = f"{_BASE}/{settings.runpod_endpoint_id}/cancel/{runpod_job_id}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=_headers())
            resp.raise_for_status()
        logger.info("runpod_job_cancelled", runpod_job_id=runpod_job_id)
    except Exception as exc:
        logger.warning("runpod_cancel_failed", runpod_job_id=runpod_job_id, error=str(exc))
