"""
Job timeout watchdog — runs every 60 s, marks stuck jobs as JOB_TIMEOUT.

A job is considered stuck when it has been in 'dispatched' or 'processing'
for longer than TIMEOUT_MINUTES without completing. This covers the case where
the RunPod worker crashes silently or the completion webhook fails to reach us.

Timeout jobs with retry_count < 1 are re-queued (JOB_TIMEOUT is a timeout
class failure — should_auto_retry allows one retry). Jobs that have already
retried once are marked permanently failed.
"""

import asyncio
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session_factory
from app.models import FailureClass, Job, JobEvent, JobStatus, Notification

logger = structlog.get_logger()

_TICK_INTERVAL = 60       # seconds between scans
TIMEOUT_MINUTES = 20      # minutes before a dispatched/processing job is considered stuck


async def _tick(db: AsyncSession) -> None:
    cutoff = datetime.now(UTC) - timedelta(minutes=TIMEOUT_MINUTES)

    result = await db.execute(
        select(Job).where(
            Job.status.in_([JobStatus.dispatched, JobStatus.processing]),
            Job.dispatched_at < cutoff,
        )
    )
    stuck_jobs = result.scalars().all()

    if not stuck_jobs:
        return

    logger.warning("watchdog_found_stuck_jobs", count=len(stuck_jobs))

    for job in stuck_jobs:
        prior_status = job.status
        job.failure_class = FailureClass.timeout
        job.failure_code = "JOB_TIMEOUT"
        job.failure_message = "Taking longer than expected. Retrying…"
        job.updated_at = datetime.now(UTC)

        db.add(JobEvent(
            job_id=job.id,
            event_type="timeout",
            from_status=prior_status,
            to_status=JobStatus.failed,
            metadata_={"stuck_since": job.dispatched_at.isoformat() if job.dispatched_at else None},
        ))

        # timeout class allows one auto-retry
        if job.retry_count < 1:
            job.status = JobStatus.queued
            job.claim_token = None
            job.runpod_job_id = None
            job.retry_count += 1
            job.dispatched_at = None
            job.started_at = None
            job.completed_at = None
            db.add(JobEvent(
                job_id=job.id,
                event_type="auto_retry",
                from_status=JobStatus.failed,
                to_status=JobStatus.queued,
                metadata_={"retry_count": job.retry_count},
            ))
            logger.info("watchdog_requeued", job_id=str(job.id), retry_count=job.retry_count)
        else:
            job.status = JobStatus.failed
            db.add(Notification(
                user_id=job.user_id,
                job_id=job.id,
                type="job_failed",
                title="Transcription failed",
                body=job.failure_message,
            ))
            logger.warning("watchdog_final_failed", job_id=str(job.id))

    await db.commit()

    # Best-effort cancel any still-running RunPod jobs
    runpod_ids = [j.runpod_job_id for j in stuck_jobs if j.runpod_job_id]
    if runpod_ids:
        from app.services.runpod import cancel_runpod_job
        await asyncio.gather(*[cancel_runpod_job(rid) for rid in runpod_ids], return_exceptions=True)


async def run_watchdog() -> None:
    logger.info("watchdog_started", timeout_minutes=TIMEOUT_MINUTES, interval=_TICK_INTERVAL)
    while True:
        await asyncio.sleep(_TICK_INTERVAL)
        try:
            async with async_session_factory() as db:
                await _tick(db)
        except Exception as exc:
            logger.error("watchdog_tick_error", error=str(exc))
