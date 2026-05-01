"""RunPod API client — dispatches jobs to the configured endpoint."""

import uuid

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()


async def dispatch_job(
    job_id: uuid.UUID,
    claim_token: uuid.UUID,
    s3_key: str,
    config: dict,
) -> None:
    """POST a job to RunPod (or fake server). Fire-and-forget — errors are logged, not raised."""
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
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.runpod_api_key:
        headers["Authorization"] = f"Bearer {settings.runpod_api_key}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                settings.runpod_endpoint_url, json=payload, headers=headers
            )
            resp.raise_for_status()
        logger.info("job_dispatched", job_id=str(job_id))
    except Exception as exc:
        # Don't re-raise — stuck dispatched jobs will be handled by the watchdog in a later phase.
        logger.error("dispatch_failed", job_id=str(job_id), error=str(exc))
