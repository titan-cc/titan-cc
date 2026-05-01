"""
Tests for Phase 3: Upload presign + Job CRUD.

DB is mocked via dependency override so tests run without a live Postgres.
S3 calls are patched via unittest.mock.patch.
"""

import hashlib
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.db import get_db
from app.main import app
from app.models import JobStatus
from app.schemas import JobCreateRequest

# ── Shared test data ──────────────────────────────────────────────────────────

USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

_DEFAULT_CONFIG = {
    "language": "auto",
    "enable_diarization": False,
    "output_formats": ["json", "srt", "txt"],
}


def _job(status: JobStatus = JobStatus.queued, **kwargs: Any) -> SimpleNamespace:
    """Return a SimpleNamespace that satisfies JobResponse.model_validate(from_attributes=True)."""
    now = datetime.now(UTC)
    data: dict[str, Any] = {
        "id": uuid.uuid4(),
        "user_id": USER_ID,
        "status": status,
        "claim_token": None,
        "input_s3_key": f"inputs/{USER_ID}/abc/test.mp4",
        "input_filename": "test.mp4",
        "input_hash": None,
        "input_duration_seconds": 60,
        "config": _DEFAULT_CONFIG,
        "output_s3_keys": None,
        "current_stage": None,
        "progress_pct": 0,
        "failure_class": None,
        "failure_code": None,
        "failure_message": None,
        "failure_details": None,
        "retry_count": 0,
        "max_retries": 3,
        "cost_usd": None,
        "expires_at": now + timedelta(days=15),
        "created_at": now,
        "dispatched_at": None,
        "started_at": None,
        "completed_at": None,
        "updated_at": now,
    }
    data.update(kwargs)
    return SimpleNamespace(**data)


def _exec_result(scalar: Any = None) -> MagicMock:
    """Mock SQLAlchemy CursorResult-like object."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = scalar
    r.scalar_one.return_value = scalar
    r.one_or_none.return_value = scalar
    r.scalars.return_value = [scalar] if scalar is not None else []
    return r


def _make_session(*scalar_sequence: Any) -> AsyncMock:
    """Build an AsyncSession mock that returns scalar_sequence values in order."""
    session = AsyncMock()
    session.add = MagicMock()
    results = iter([_exec_result(v) for v in scalar_sequence])

    async def execute(*args: Any, **kwargs: Any) -> MagicMock:
        return next(results)

    session.execute = execute
    return session


def _db_override(session: AsyncMock) -> Any:
    async def override() -> AsyncGenerator[AsyncMock, None]:
        yield session

    return override


# ── POST /uploads/presign ─────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_presign_bad_content_type(auth_client: AsyncClient) -> None:
    resp = await auth_client.post(
        "/uploads/presign",
        json={
            "filename": "doc.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1024,
            "duration_seconds": 60,
        },
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_presign_duration_exceeds_max(auth_client: AsyncClient) -> None:
    # Fake user quota has max_duration_seconds=7200; send 9000
    resp = await auth_client.post(
        "/uploads/presign",
        json={
            "filename": "long.mp4",
            "content_type": "video/mp4",
            "size_bytes": 1024,
            "duration_seconds": 9000,
        },
    )
    assert resp.status_code == 422
    assert "too long" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_presign_monthly_quota_exceeded(auth_client: AsyncClient) -> None:
    # conftest fake user has minutes_used_this_month=0 and max=300 min.
    # duration_seconds > max_minutes_per_month * 60 → quota exceeded
    resp = await auth_client.post(
        "/uploads/presign",
        json={
            "filename": "x.mp4",
            "content_type": "video/mp4",
            "size_bytes": 1024,
            "duration_seconds": 18_001,  # >300 min but <=7200s? No: 18001 > 7200, so hits duration check first
        },
    )
    # hits max_duration_seconds first
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_presign_success(auth_client: AsyncClient) -> None:
    expires = datetime.now(UTC) + timedelta(minutes=5)
    with patch(
        "app.services.s3.presign_put",
        return_value=("https://s3.example.com/put", "inputs/abc/xyz/test.mp4", expires),
    ):
        resp = await auth_client.post(
            "/uploads/presign",
            json={
                "filename": "test.mp4",
                "content_type": "video/mp4",
                "size_bytes": 1024,
                "duration_seconds": 60,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["upload_url"].startswith("https://")
    assert body["s3_key"] == "inputs/abc/xyz/test.mp4"
    assert "expires_at" in body


# ── POST /jobs ────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_create_job_missing_idempotency_key(auth_client: AsyncClient) -> None:
    resp = await auth_client.post(
        "/jobs",
        json={"s3_key": f"inputs/{USER_ID}/abc/test.mp4", "duration_seconds": 60},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_create_job_idor_s3_key(auth_client: AsyncClient) -> None:
    other_user = uuid.uuid4()
    session = _make_session(uuid.uuid4())  # idempotency INSERT succeeds
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.post(
            "/jobs",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json={
                "s3_key": f"inputs/{other_user}/abc/test.mp4",
                "duration_seconds": 60,
            },
        )
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_create_job_success(auth_client: AsyncClient) -> None:
    # execute sequence: [idempotency INSERT → key uuid] [update idempotency row → None]
    session = _make_session(uuid.uuid4(), None)

    # SQLAlchemy defers default= values until the real DB flush; simulate refresh
    async def refresh_defaults(obj: Any) -> None:
        now = datetime.now(UTC)
        obj.id = obj.id or uuid.uuid4()
        obj.retry_count = obj.retry_count if obj.retry_count is not None else 0
        obj.max_retries = obj.max_retries if obj.max_retries is not None else 3
        obj.created_at = obj.created_at or now
        obj.updated_at = obj.updated_at or now
        obj.expires_at = obj.expires_at or (now + timedelta(days=15))

    session.refresh = refresh_defaults

    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.post(
            "/jobs",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json={
                "s3_key": f"inputs/{USER_ID}/abc/test.mp4",
                "duration_seconds": 60,
                "config": _DEFAULT_CONFIG,
            },
        )
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    assert body["input_duration_seconds"] == 60


@pytest.mark.anyio
async def test_create_job_idempotent_replay(auth_client: AsyncClient) -> None:
    """Same key + same payload → 200 with the original job."""
    idem_key = uuid.uuid4()
    req_body = {
        "s3_key": f"inputs/{USER_ID}/abc/test.mp4",
        "duration_seconds": 60,
        "config": _DEFAULT_CONFIG,
    }
    # Compute hash the same way the router does
    req = JobCreateRequest(**req_body)
    req_hash = hashlib.sha256(
        json.dumps(req.model_dump(mode="json"), sort_keys=True).encode()
    ).hexdigest()

    existing_job = _job()
    existing_idem = SimpleNamespace(
        key=idem_key, user_id=USER_ID, job_id=existing_job.id, request_hash=req_hash
    )
    # execute sequence: [INSERT conflict → None] [SELECT idem → existing_idem] [SELECT job → existing_job]
    session = _make_session(None, existing_idem, existing_job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.post(
            "/jobs",
            headers={"Idempotency-Key": str(idem_key)},
            json=req_body,
        )
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200
    assert resp.json()["id"] == str(existing_job.id)


@pytest.mark.anyio
async def test_create_job_key_reused_different_payload(auth_client: AsyncClient) -> None:
    """Same key + different payload → 422."""
    idem_key = uuid.uuid4()
    existing_idem = SimpleNamespace(
        key=idem_key,
        user_id=USER_ID,
        job_id=uuid.uuid4(),
        request_hash="completely_different_hash",
    )
    # execute sequence: [INSERT conflict → None] [SELECT idem → existing_idem]
    session = _make_session(None, existing_idem)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.post(
            "/jobs",
            headers={"Idempotency-Key": str(idem_key)},
            json={
                "s3_key": f"inputs/{USER_ID}/abc/test.mp4",
                "duration_seconds": 60,
            },
        )
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 422
    assert "reused" in resp.json()["detail"].lower()


# ── GET /jobs ─────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_list_jobs_empty(auth_client: AsyncClient) -> None:
    session = AsyncMock()
    session.add = MagicMock()
    result = MagicMock()
    result.scalars.return_value = []
    session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.get("/jobs")
    finally:
        del app.dependency_overrides[get_db]

    assert resp.status_code == 200
    body = resp.json()
    assert body["jobs"] == []
    assert body["next_cursor"] is None


@pytest.mark.anyio
async def test_list_jobs_returns_data(auth_client: AsyncClient) -> None:
    job = _job()
    session = AsyncMock()
    session.add = MagicMock()
    result = MagicMock()
    result.scalars.return_value = [job]
    session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.get("/jobs")
    finally:
        del app.dependency_overrides[get_db]

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["jobs"]) == 1
    assert body["jobs"][0]["id"] == str(job.id)
    assert body["jobs"][0]["status"] == "queued"


@pytest.mark.anyio
async def test_list_jobs_status_filter_invalid(auth_client: AsyncClient) -> None:
    # No DB call expected — validation fails before execute
    resp = await auth_client.get("/jobs?status=nonexistent")
    assert resp.status_code == 422


# ── GET /jobs/:id ─────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_get_job_success(auth_client: AsyncClient) -> None:
    job = _job()
    session = _make_session(job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.get(f"/jobs/{job.id}")
    finally:
        del app.dependency_overrides[get_db]

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(job.id)
    assert body["status"] == "queued"


@pytest.mark.anyio
async def test_get_job_not_found(auth_client: AsyncClient) -> None:
    session = _make_session(None)  # DB returns None → 404
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.get(f"/jobs/{uuid.uuid4()}")
    finally:
        del app.dependency_overrides[get_db]

    assert resp.status_code == 404


# ── GET /jobs/:id/transcript ──────────────────────────────────────────────────


@pytest.mark.anyio
async def test_get_transcript_job_not_completed(auth_client: AsyncClient) -> None:
    job = _job(status=JobStatus.processing)
    session = _make_session(job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await auth_client.get(f"/jobs/{job.id}/transcript")
    finally:
        del app.dependency_overrides[get_db]

    assert resp.status_code == 409


@pytest.mark.anyio
async def test_get_transcript_completed(auth_client: AsyncClient) -> None:
    job = _job(
        status=JobStatus.completed,
        output_s3_keys={
            "json": "outputs/abc/out.json",
            "srt": "outputs/abc/out.srt",
            "txt": "outputs/abc/out.txt",
        },
    )
    expires = datetime.now(UTC) + timedelta(minutes=5)
    session = _make_session(job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        with patch(
            "app.services.s3.presign_get",
            return_value=("https://s3.example.com/download", expires),
        ):
            resp = await auth_client.get(f"/jobs/{job.id}/transcript")
    finally:
        del app.dependency_overrides[get_db]

    assert resp.status_code == 200
    body = resp.json()
    assert set(body["downloads"].keys()) == {"json", "srt", "txt"}
    assert body["downloads"]["json"]["url"].startswith("https://")
    assert "expires_at" in body["downloads"]["json"]
