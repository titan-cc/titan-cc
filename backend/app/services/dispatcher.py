"""
Background dispatcher — claims queued jobs and sends them to RunPod.

Runs as a long-lived asyncio task started in FastAPI's lifespan.
One tick per 10 s; claims at most one job per tick using FOR UPDATE SKIP LOCKED
so multiple server instances won't double-dispatch the same job.
"""

import asyncio

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session_factory
from app.models import JobEvent, JobStatus
from app.services.runpod import dispatch_job

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
    await dispatch_job(job_id, claim_token, s3_key, config)


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
