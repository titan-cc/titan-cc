"""
POST /webhooks/runpod

Authentication: HMAC-SHA256 over "{timestamp}.{nonce}.{raw_body}" using
the shared RUNPOD_WEBHOOK_SECRET.  Replay protection via timestamp (<5 min)
and in-memory nonce deduplication (10-min window).
"""

import hashlib
import hmac
import json
import math
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.deps import get_db
from app.models import FailureClass, Job, JobEvent, JobStatus, Notification, Quota, User
from app.schemas import (
    RunpodWebhookBody,
    WebhookCompletedPayload,
    WebhookFailedPayload,
    WebhookProgressPayload,
)
from app.services.activity import log_activity
from app.services.email import send_job_completed_email, send_job_failed_email
from app.services import s3 as s3_service

logger = structlog.get_logger()
router = APIRouter()

# ── Replay protection ──────────────────────────────────────────────────────────

_seen_nonces: dict[str, float] = {}  # {nonce: expiry_unix_ts}
_NONCE_TTL = 600  # 10 minutes
_TS_MAX_AGE = 300  # 5 minutes


def _verify_hmac(
    body: bytes,
    signature_header: str,
    timestamp_header: str,
    nonce_header: str,
) -> None:
    """Raise HTTP 401 if HMAC, timestamp, or nonce checks fail."""
    try:
        ts = float(timestamp_header)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid timestamp")
    if abs(time.time() - ts) > _TS_MAX_AGE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Request expired")

    now = time.time()
    for k in [k for k, v in _seen_nonces.items() if v < now]:
        del _seen_nonces[k]
    if nonce_header in _seen_nonces:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nonce already seen")
    _seen_nonces[nonce_header] = now + _NONCE_TTL

    if not signature_header.startswith("sha256="):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad signature format")
    expected = hmac.new(
        settings.runpod_webhook_secret.encode(),
        f"{timestamp_header}.{nonce_header}.".encode() + body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature_header[7:]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad signature")


# ── Retry logic ────────────────────────────────────────────────────────────────

def should_auto_retry(job: Job) -> bool:
    """True if the job should be automatically re-queued based on failure_class and retry count."""
    if job.failure_class == FailureClass.system_transient:
        return job.retry_count < job.max_retries
    if job.failure_class == FailureClass.timeout:
        return job.retry_count < 1
    return False


# ── Event handlers ─────────────────────────────────────────────────────────────

async def _handle_started(job: Job, db: AsyncSession) -> None:
    job.status = JobStatus.processing
    job.started_at = datetime.now(UTC)
    job.updated_at = datetime.now(UTC)
    db.add(JobEvent(
        job_id=job.id, event_type="started",
        from_status=JobStatus.dispatched, to_status=JobStatus.processing,
    ))


async def _handle_progress(job: Job, payload: dict[str, Any], db: AsyncSession) -> None:
    try:
        p = WebhookProgressPayload(**payload)
    except Exception:
        return
    # First progress event means the worker is running — auto-transition dispatched → processing.
    if job.status == JobStatus.dispatched:
        job.status = JobStatus.processing
        job.started_at = datetime.now(UTC)
        db.add(JobEvent(
            job_id=job.id, event_type="started",
            from_status=JobStatus.dispatched, to_status=JobStatus.processing,
        ))
    job.current_stage = p.current_stage
    job.progress_pct = p.progress_pct
    job.updated_at = datetime.now(UTC)
    db.add(JobEvent(
        job_id=job.id, event_type="progress",
        metadata_={"stage": p.current_stage, "pct": p.progress_pct},
    ))


async def _handle_completed(job: Job, payload: dict[str, Any], db: AsyncSession) -> None:
    p = WebhookCompletedPayload(**payload)
    job.status = JobStatus.completed
    job.output_s3_keys = p.output_s3_keys
    job.cost_usd = p.cost_usd
    job.input_hash = p.input_hash
    job.completed_at = datetime.now(UTC)
    job.progress_pct = 100
    job.current_stage = "done"
    job.updated_at = datetime.now(UTC)
    db.add(JobEvent(
        job_id=job.id, event_type="completed",
        from_status=JobStatus.processing, to_status=JobStatus.completed,
    ))

    # Pull transcript text from S3 for full-text search indexing
    txt_key = p.output_s3_keys.get("txt")
    if txt_key:
        try:
            job.transcript_text = s3_service.get_text(txt_key)
        except Exception:
            logger.warning("transcript_text_fetch_failed", job_id=str(job.id))

    # Increment quota usage atomically
    minutes = math.ceil(job.input_duration_seconds / 60)
    await db.execute(
        update(Quota)
        .where(Quota.user_id == job.user_id)
        .values(minutes_used_this_month=Quota.minutes_used_this_month + minutes)
    )

    # Notify user
    user = (await db.execute(select(User).where(User.id == job.user_id))).scalar_one_or_none()
    if user:
        db.add(Notification(
            user_id=user.id,
            job_id=job.id,
            type="job_completed",
            title="Transcription complete",
            body=f"Your {minutes}-minute file is ready to download.",
        ))
        await send_job_completed_email(user.email, str(job.id), job.input_duration_seconds)

    await log_activity(db, job.user_id, "job_completed", metadata={
        "job_id": str(job.id),
        "cost_usd": p.cost_usd,
        "duration_seconds": job.input_duration_seconds,
    })


async def _handle_failed(job: Job, payload: dict[str, Any], db: AsyncSession) -> None:
    try:
        p = WebhookFailedPayload(**payload)
    except Exception:
        p = WebhookFailedPayload(
            failure_class=FailureClass.system_permanent,
            failure_code="WORKER_CRASHED",
            failure_message="Something went wrong on our end.",
        )

    prior_status = job.status

    # Always record the failure fields so they're visible in history
    job.failure_class = p.failure_class
    job.failure_code = p.failure_code
    job.failure_message = p.failure_message
    job.failure_details = p.failure_details
    job.updated_at = datetime.now(UTC)

    db.add(JobEvent(
        job_id=job.id, event_type="failed",
        from_status=prior_status, to_status=JobStatus.failed,
        metadata_={"code": p.failure_code, "class": p.failure_class},
    ))

    if should_auto_retry(job):
        job.status = JobStatus.queued
        job.claim_token = None
        job.retry_count += 1
        job.dispatched_at = None
        job.started_at = None
        job.completed_at = None
        db.add(JobEvent(
            job_id=job.id, event_type="auto_retry",
            from_status=JobStatus.failed, to_status=JobStatus.queued,
            metadata_={"retry_count": job.retry_count},
        ))
        logger.info("job_auto_retry", job_id=str(job.id), retry_count=job.retry_count,
                    failure_code=p.failure_code)
    else:
        job.status = JobStatus.failed

        user = (await db.execute(select(User).where(User.id == job.user_id))).scalar_one_or_none()
        if user:
            db.add(Notification(
                user_id=user.id,
                job_id=job.id,
                type="job_failed",
                title="Transcription failed",
                body=p.failure_message,
            ))
            await send_job_failed_email(user.email, str(job.id), p.failure_message)

        await log_activity(db, job.user_id, "job_failed", metadata={
            "job_id": str(job.id),
            "failure_code": p.failure_code,
            "failure_class": str(p.failure_class),
        })


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/runpod")
async def runpod_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_runpod_signature: str = Header(...),
    x_runpod_timestamp: str = Header(...),
    x_runpod_nonce: str = Header(...),
) -> dict[str, bool]:
    body = await request.body()
    _verify_hmac(body, x_runpod_signature, x_runpod_timestamp, x_runpod_nonce)

    try:
        data = RunpodWebhookBody.model_validate(json.loads(body))
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    result = await db.execute(select(Job).where(Job.id == data.job_id))
    job = result.scalar_one_or_none()
    if job is None:
        logger.warning("webhook_unknown_job", job_id=str(data.job_id))
        return {"ok": True}

    if job.claim_token != data.claim_token:
        logger.warning("webhook_stale_token", job_id=str(data.job_id),
                       got=str(data.claim_token), expected=str(job.claim_token))
        return {"ok": True}

    event = data.event
    if event == "started":
        await _handle_started(job, db)
    elif event == "progress":
        await _handle_progress(job, data.payload, db)
    elif event == "completed":
        await _handle_completed(job, data.payload, db)
    elif event == "failed":
        await _handle_failed(job, data.payload, db)
    else:
        logger.warning("webhook_unknown_event", event=event, job_id=str(data.job_id))

    await db.commit()
    logger.info("webhook_processed", webhook_event=event, job_id=str(data.job_id))
    return {"ok": True}
