"""
Background dispatcher — claims queued jobs and sends them to RunPod.

Runs as a long-lived asyncio task started in FastAPI's lifespan.
One tick per 10 s; claims at most one job per tick using FOR UPDATE SKIP LOCKED
so multiple server instances won't double-dispatch the same job.
"""

import asyncio

import structlog
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session_factory
from app.models import Job, JobEvent, JobStatus
from app.services.runpod import dispatch_job
from app.services.vocabulary import worker_payload

logger = structlog.get_logger()

_TICK_INTERVAL = 10  # seconds


async def _tick(db: AsyncSession) -> None:
    """Claim one queued job and dispatch it. No-op if queue is empty."""
    result = await db.execute(
        text("""
            UPDATE jobs
            SET status      = 'dispatched',
                claim_token = gen_random_uuid(),
                dispatched_at = NOW(),
                updated_at  = NOW()
            WHERE id = (
                SELECT id FROM jobs
                WHERE  status = 'queued'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, claim_token, input_s3_key, config
        """)
    )
    row = result.fetchone()
    if row is None:
        return

    job_id, claim_token, s3_key, config = row.id, row.claim_token, row.input_s3_key, row.config
    db.add(
        JobEvent(
            job_id=job_id,
            event_type="dispatched",
            from_status=JobStatus.queued,
            to_status=JobStatus.dispatched,
        )
    )
    await db.commit()

    logger.info("dispatcher_claimed", job_id=str(job_id))

    # Send the team word list with the job (not stored on the job). A failure here
    # must never stop the transcription, so the job goes out without it.
    try:
        config = {**(config or {}), "vocabulary": await worker_payload(db)}
    except Exception as exc:
        logger.warning("vocabulary_payload_failed", job_id=str(job_id), error=str(exc))

    runpod_job_id = await dispatch_job(job_id, claim_token, s3_key, config)

    if runpod_job_id:
        async with async_session_factory() as db2:
            await db2.execute(
                update(Job).where(Job.id == job_id).values(runpod_job_id=runpod_job_id)
            )
            await db2.commit()


async def run_dispatcher() -> None:
    """Loop forever, ticking every _TICK_INTERVAL seconds."""
    logger.info("dispatcher_started", interval=_TICK_INTERVAL)
    while True:
        try:
            async with async_session_factory() as db:
                await _tick(db)
        except Exception as exc:
            logger.error("dispatcher_tick_error", error=str(exc))
        await asyncio.sleep(_TICK_INTERVAL)
