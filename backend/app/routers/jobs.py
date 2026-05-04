import hashlib
import json
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import IdempotencyKey, Job, JobEvent, JobStatus, User
from app.services.activity import log_activity
from app.schemas import (
    DownloadLink,
    JobCreateRequest,
    JobListResponse,
    JobResponse,
    TranscriptResponse,
    TranscriptUpdateRequest,
)
from app.services import s3 as s3_service
from app.services.quotas import check_concurrent, check_quota

router = APIRouter()


def _request_hash(body: JobCreateRequest) -> str:
    return hashlib.sha256(
        json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()
    ).hexdigest()


async def _get_job_or_404(
    job_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession, *, is_admin: bool = False
) -> Job:
    q = select(Job).where(Job.id == job_id)
    if not is_admin:
        q = q.where(Job.user_id == user_id)
    result = await db.execute(q)
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


@router.post("", response_model=JobResponse, status_code=201)
async def create_job(
    body: JobCreateRequest,
    response: Response,
    idempotency_key: uuid.UUID = Header(..., alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    req_hash = _request_hash(body)

    # Atomically claim the idempotency key slot
    stmt = (
        pg_insert(IdempotencyKey)
        .values(key=idempotency_key, user_id=user.id, request_hash=req_hash)
        .on_conflict_do_nothing(index_elements=["key"])
        .returning(IdempotencyKey.key)
    )
    result = await db.execute(stmt)
    inserted = result.scalar_one_or_none() is not None

    if not inserted:
        # Key already exists — check if it's a replay or a collision
        idem = (
            await db.execute(select(IdempotencyKey).where(IdempotencyKey.key == idempotency_key))
        ).scalar_one()

        if idem.request_hash != req_hash:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Idempotency key reused with different payload",
            )
        if idem.job_id is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Concurrent request in progress")

        job = (await db.execute(select(Job).where(Job.id == idem.job_id))).scalar_one()
        response.status_code = status.HTTP_200_OK
        return JobResponse.model_validate(job)

    # Validate s3_key ownership (IDOR guard)
    if not body.s3_key.startswith(f"inputs/{user.id}/"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="s3_key does not belong to this user",
        )

    if user.quota is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Quota not initialized")

    # Re-check quota (defense in depth — presign already checked, but race conditions exist)
    await check_quota(user.quota, body.duration_seconds, db)
    await check_concurrent(user.quota, user.id, db)

    job = Job(
        user_id=user.id,
        input_s3_key=body.s3_key,
        input_filename=body.filename,
        input_duration_seconds=body.duration_seconds,
        config=body.config.model_dump(),
        status=JobStatus.queued,
    )
    db.add(job)
    await db.flush()

    db.add(JobEvent(job_id=job.id, event_type="created", to_status=JobStatus.queued))

    await db.execute(
        update(IdempotencyKey)
        .where(IdempotencyKey.key == idempotency_key)
        .values(job_id=job.id)
    )

    await log_activity(db, user.id, "job_submitted", metadata={
        "job_id": str(job.id),
        "filename": body.filename,
        "duration_seconds": body.duration_seconds,
    })

    await db.commit()
    await db.refresh(job)
    return JobResponse.model_validate(job)


@router.get("", response_model=JobListResponse)
async def list_jobs(
    cursor: uuid.UUID | None = None,
    limit: int = 20,
    status: str | None = None,
    folder_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobListResponse:
    limit = min(max(1, limit), 100)

    q = select(Job).where(Job.user_id == user.id)

    if status is not None:
        try:
            q = q.where(Job.status == JobStatus(status))
        except ValueError:
            raise HTTPException(
                status_code=422, detail=f"Invalid status filter: {status}"
            )

    if folder_id == "unfiled":
        q = q.where(Job.folder_id.is_(None))
    elif folder_id is not None:
        try:
            q = q.where(Job.folder_id == uuid.UUID(folder_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid folder_id")

    if cursor is not None:
        row = (
            await db.execute(
                select(Job.created_at, Job.id)
                .where(Job.id == cursor, Job.user_id == user.id)
            )
        ).one_or_none()
        if row is not None:
            cur_ts, cur_id = row
            q = q.where(
                or_(
                    Job.created_at < cur_ts,
                    and_(Job.created_at == cur_ts, Job.id < cur_id),
                )
            )

    q = q.order_by(Job.created_at.desc(), Job.id.desc()).limit(limit + 1)
    jobs = list((await db.execute(q)).scalars())

    next_cursor = None
    if len(jobs) > limit:
        next_cursor = jobs[limit].id
        jobs = jobs[:limit]

    return JobListResponse(jobs=jobs, next_cursor=next_cursor)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    job = await _get_job_or_404(job_id, user.id, db, is_admin=user.role == "admin")
    return JobResponse.model_validate(job)


@router.get("/{job_id}/transcript", response_model=TranscriptResponse)
async def get_transcript(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    job = await _get_job_or_404(job_id, user.id, db, is_admin=user.role == "admin")
    if job.status != JobStatus.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not completed")
    if not job.output_s3_keys:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No transcript available")

    downloads: dict[str, DownloadLink] = {}
    for fmt, s3_key in job.output_s3_keys.items():
        url, expires_at = s3_service.presign_get(s3_key)
        downloads[fmt] = DownloadLink(url=url, expires_at=expires_at)

    # Presign the input video with a long TTL so a 2-hour video doesn't expire mid-playback
    video_url, _ = s3_service.presign_get(job.input_s3_key, expires_in=7200)

    return TranscriptResponse(downloads=downloads, video_url=video_url)


def _srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _build_json(segments: list[dict], job_id_str: str) -> bytes:
    return json.dumps(
        {"job_id": job_id_str, "segments": segments}, ensure_ascii=False, indent=2
    ).encode("utf-8")


def _build_srt(segments: list[dict]) -> bytes:
    lines: list[str] = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{_srt_time(seg['start'])} --> {_srt_time(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines).encode("utf-8")


def _build_txt(segments: list[dict]) -> bytes:
    return "\n".join(seg["text"] for seg in segments).encode("utf-8")


@router.put("/{job_id}/transcript", response_model=TranscriptResponse)
async def update_transcript(
    job_id: uuid.UUID,
    body: TranscriptUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    job = await _get_job_or_404(job_id, user.id, db)
    if job.status != JobStatus.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not completed")
    if not job.output_s3_keys:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No transcript available")

    segs = [s.model_dump(exclude_none=False) for s in body.segments]
    job_id_str = str(job_id)

    format_bytes: dict[str, tuple[bytes, str]] = {
        "json": (_build_json(segs, job_id_str), "application/json"),
        "srt":  (_build_srt(segs), "text/plain; charset=utf-8"),
        "txt":  (_build_txt(segs), "text/plain; charset=utf-8"),
    }

    for fmt, s3_key in job.output_s3_keys.items():
        if fmt in format_bytes:
            content, content_type = format_bytes[fmt]
            s3_service.put_bytes(s3_key, content, content_type)

    downloads: dict[str, DownloadLink] = {}
    for fmt, s3_key in job.output_s3_keys.items():
        url, expires_at = s3_service.presign_get(s3_key)
        downloads[fmt] = DownloadLink(url=url, expires_at=expires_at)

    video_url, _ = s3_service.presign_get(job.input_s3_key, expires_in=7200)
    return TranscriptResponse(downloads=downloads, video_url=video_url)


@router.patch("/{job_id}/folder", response_model=JobResponse)
async def move_to_folder(
    job_id: uuid.UUID,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    from datetime import UTC, datetime
    from app.models import Folder

    job = await _get_job_or_404(job_id, user.id, db)
    folder_id: uuid.UUID | None = body.get("folder_id")

    if folder_id is not None:
        folder = (
            await db.execute(
                select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id)
            )
        ).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    job.folder_id = folder_id
    job.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(job)
    return JobResponse.model_validate(job)


@router.post("/{job_id}/retry", response_model=JobResponse)
async def retry_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    from datetime import UTC, datetime
    from app.models import JobEvent

    job = await _get_job_or_404(job_id, user.id, db)
    if job.status != JobStatus.failed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not in failed state")

    job.status = JobStatus.queued
    job.claim_token = None
    job.retry_count = job.max_retries  # exhausted — auto-retry won't re-queue after a manual retry fails again
    job.failure_class = None
    job.failure_code = None
    job.failure_message = None
    job.failure_details = None
    job.dispatched_at = None
    job.started_at = None
    job.completed_at = None
    job.updated_at = datetime.now(UTC)

    db.add(JobEvent(job_id=job.id, event_type="manual_retry", to_status=JobStatus.queued))
    await log_activity(db, user.id, "job_retried", metadata={"job_id": str(job.id)})

    await db.commit()
    await db.refresh(job)
    return JobResponse.model_validate(job)


@router.post("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    from datetime import UTC, datetime
    from app.models import JobEvent

    job = await _get_job_or_404(job_id, user.id, db)

    cancellable = {JobStatus.queued, JobStatus.dispatched, JobStatus.processing}
    if job.status not in cancellable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel a job with status '{job.status.value}'",
        )

    prior_status = job.status
    runpod_job_id = job.runpod_job_id

    job.status = JobStatus.cancelled
    job.claim_token = None  # invalidate so any in-flight worker webhook is rejected
    job.runpod_job_id = None
    job.updated_at = datetime.now(UTC)

    db.add(JobEvent(
        job_id=job.id, event_type="cancelled",
        from_status=prior_status, to_status=JobStatus.cancelled,
    ))
    await log_activity(db, user.id, "job_cancelled", metadata={"job_id": str(job.id)})

    await db.commit()
    await db.refresh(job)

    # Best-effort cancel on RunPod — after DB commit so our state is consistent regardless
    if runpod_job_id:
        from app.services.runpod import cancel_runpod_job
        await cancel_runpod_job(runpod_job_id)

    return JobResponse.model_validate(job)
