"""
GET /internal/jobs/{job_id}/alive

Machine-to-machine endpoint polled by the RunPod worker between pipeline
stages to detect mid-job cancellation without wasting GPU time.

Auth: Authorization: Bearer {RUNPOD_WEBHOOK_SECRET}
      Same secret used for incoming webhooks — no extra credential needed.

Query param: claim_token=<uuid>

Returns {"alive": true}  — job exists, token matches, status is dispatched or processing.
Returns {"alive": false} — job cancelled, wrong token, or any other terminal state.
"""

import uuid

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.deps import get_db
from app.models import Job, JobStatus

logger = structlog.get_logger()
router = APIRouter()

_ACTIVE_STATUSES = {JobStatus.dispatched, JobStatus.processing}


def _require_worker_token(authorization: str = Header(...)) -> None:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")
    if token != settings.runpod_webhook_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@router.get("/jobs/{job_id}/alive")
async def job_alive(
    job_id: uuid.UUID,
    claim_token: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_require_worker_token),
) -> dict:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()

    if job is None:
        return {"alive": False}

    alive = (
        job.status in _ACTIVE_STATUSES
        and job.claim_token is not None
        and str(job.claim_token) == str(claim_token)
    )

    logger.info("alive_check", job_id=str(job_id), status=job.status.value, alive=alive)
    return {"alive": alive}
