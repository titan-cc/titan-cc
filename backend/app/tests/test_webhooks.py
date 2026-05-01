"""Tests for POST /webhooks/runpod — HMAC verification + event handling."""

import hashlib
import hmac
import json
import time
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

from app.db import get_db
from app.main import app
from app.models import FailureClass, JobStatus
from app.routers import webhooks as webhooks_module

# ── Helpers ────────────────────────────────────────────────────────────────────

SECRET = "dev-secret"
USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def _sign(body: bytes, secret: str = SECRET, ts: float | None = None, nonce: str | None = None) -> dict[str, str]:
    """Produce the three HMAC headers for a body."""
    ts_str = str(ts or time.time())
    nonce_str = nonce or str(uuid.uuid4())
    message = f"{ts_str}.{nonce_str}.".encode() + body
    sig = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return {
        "X-Runpod-Signature": f"sha256={sig}",
        "X-Runpod-Timestamp": ts_str,
        "X-Runpod-Nonce": nonce_str,
        "Content-Type": "application/json",
    }


def _webhook_body(
    job_id: uuid.UUID,
    claim_token: uuid.UUID,
    event: str = "started",
    payload: dict | None = None,
) -> bytes:
    return json.dumps({
        "job_id": str(job_id),
        "claim_token": str(claim_token),
        "event": event,
        "timestamp": str(time.time()),
        "payload": payload or {},
    }).encode()


def _job(status: JobStatus = JobStatus.dispatched, **kwargs: Any) -> SimpleNamespace:
    now = datetime.now(UTC)
    data: dict[str, Any] = {
        "id": uuid.uuid4(),
        "user_id": USER_ID,
        "status": status,
        "claim_token": uuid.uuid4(),
        "input_s3_key": f"inputs/{USER_ID}/abc/test.mp4",
        "input_duration_seconds": 60,
        "config": {},
        "output_s3_keys": None,
        "current_stage": None,
        "progress_pct": 0,
        "failure_class": None,
        "failure_code": None,
        "failure_message": None,
        "failure_details": None,
        "retry_count": 0,
        "expires_at": now + timedelta(days=15),
        "created_at": now,
        "updated_at": now,
    }
    data.update(kwargs)
    return SimpleNamespace(**data)


def _db_override(session: AsyncMock) -> Any:
    async def override() -> AsyncGenerator[AsyncMock, None]:
        yield session
    return override


def _make_session(scalar: Any = None) -> AsyncMock:
    session = AsyncMock()
    session.add = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    session.execute = AsyncMock(return_value=result)
    return session


# ── HMAC / auth tests ─────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_webhook_missing_headers(client: AsyncClient) -> None:
    body = _webhook_body(uuid.uuid4(), uuid.uuid4())
    resp = await client.post("/webhooks/runpod", content=body,
                             headers={"Content-Type": "application/json"})
    assert resp.status_code == 422  # FastAPI: missing required headers


@pytest.mark.anyio
async def test_webhook_bad_signature(client: AsyncClient) -> None:
    # Clear nonce cache so this test doesn't collide
    webhooks_module._seen_nonces.clear()
    job_id, claim_token = uuid.uuid4(), uuid.uuid4()
    body = _webhook_body(job_id, claim_token)
    headers = _sign(body, secret="wrong-secret")
    resp = await client.post("/webhooks/runpod", content=body, headers=headers)
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_webhook_stale_timestamp(client: AsyncClient) -> None:
    webhooks_module._seen_nonces.clear()
    job_id, claim_token = uuid.uuid4(), uuid.uuid4()
    body = _webhook_body(job_id, claim_token)
    old_ts = time.time() - 400  # 400s ago — beyond the 5-min window
    headers = _sign(body, ts=old_ts)
    resp = await client.post("/webhooks/runpod", content=body, headers=headers)
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_webhook_replay_nonce(client: AsyncClient) -> None:
    """Same nonce used twice → second request rejected."""
    webhooks_module._seen_nonces.clear()
    job_id, claim_token = uuid.uuid4(), uuid.uuid4()
    nonce = str(uuid.uuid4())

    body = _webhook_body(job_id, claim_token)
    headers = _sign(body, nonce=nonce)

    # First request — succeeds (unknown job → 200 ok)
    session = _make_session(None)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp1 = await client.post("/webhooks/runpod", content=body, headers=headers)
        assert resp1.status_code == 200
    finally:
        del app.dependency_overrides[get_db]

    # Second request — same nonce
    body2 = _webhook_body(job_id, claim_token)
    headers2 = _sign(body2, nonce=nonce)  # same nonce, fresh signature
    resp2 = await client.post("/webhooks/runpod", content=body2, headers=headers2)
    assert resp2.status_code == 401


# ── Event handling ─────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_webhook_unknown_job(client: AsyncClient) -> None:
    """Unknown job_id → silently 200 (don't error, RunPod may retry)."""
    webhooks_module._seen_nonces.clear()
    session = _make_session(None)  # DB returns None
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        body = _webhook_body(uuid.uuid4(), uuid.uuid4(), event="started")
        resp = await client.post("/webhooks/runpod", content=body, headers=_sign(body))
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@pytest.mark.anyio
async def test_webhook_stale_claim_token(client: AsyncClient) -> None:
    """Webhook with wrong claim_token → silently 200."""
    webhooks_module._seen_nonces.clear()
    job = _job()
    body = _webhook_body(job.id, uuid.uuid4(), event="started")  # different claim_token
    session = _make_session(job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await client.post("/webhooks/runpod", content=body, headers=_sign(body))
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_webhook_started(client: AsyncClient) -> None:
    webhooks_module._seen_nonces.clear()
    job = _job(status=JobStatus.dispatched)
    body = _webhook_body(job.id, job.claim_token, event="started")
    session = _make_session(job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await client.post("/webhooks/runpod", content=body, headers=_sign(body))
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200
    assert job.status == JobStatus.processing
    assert job.started_at is not None


@pytest.mark.anyio
async def test_webhook_progress(client: AsyncClient) -> None:
    webhooks_module._seen_nonces.clear()
    job = _job(status=JobStatus.processing)
    body = _webhook_body(job.id, job.claim_token, event="progress",
                         payload={"current_stage": "transcribing", "progress_pct": 55})
    session = _make_session(job)
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await client.post("/webhooks/runpod", content=body, headers=_sign(body))
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200
    assert job.progress_pct == 55
    assert job.current_stage == "transcribing"


@pytest.mark.anyio
async def test_webhook_completed(client: AsyncClient) -> None:
    webhooks_module._seen_nonces.clear()
    job = _job(status=JobStatus.processing)
    output_keys = {
        "json": f"outputs/{job.id}/transcript.json",
        "srt":  f"outputs/{job.id}/transcript.srt",
        "txt":  f"outputs/{job.id}/transcript.txt",
    }
    body = _webhook_body(job.id, job.claim_token, event="completed", payload={
        "output_s3_keys": output_keys,
        "cost_usd": 0.005,
        "input_hash": "abc123",
    })

    # execute sequence: [select job] [update quota] [select user → None skips email]
    session = AsyncMock()
    session.add = MagicMock()
    results = iter([
        MagicMock(**{"scalar_one_or_none.return_value": job}),
        MagicMock(),  # quota update
        MagicMock(**{"scalar_one_or_none.return_value": None}),  # user query (skip email)
    ])
    session.execute = AsyncMock(side_effect=lambda *a, **k: next(results))

    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await client.post("/webhooks/runpod", content=body, headers=_sign(body))
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200
    assert job.status == JobStatus.completed
    assert job.output_s3_keys == output_keys
    assert job.progress_pct == 100


@pytest.mark.anyio
async def test_webhook_failed(client: AsyncClient) -> None:
    webhooks_module._seen_nonces.clear()
    job = _job(status=JobStatus.processing)
    body = _webhook_body(job.id, job.claim_token, event="failed", payload={
        "failure_class": "user_content",
        "failure_code": "FILE_UNREADABLE",
        "failure_message": "Your file appears corrupt.",
    })
    # execute sequence: [select job] [select user → None skips email/notification]
    session = AsyncMock()
    session.add = MagicMock()
    results = iter([
        MagicMock(**{"scalar_one_or_none.return_value": job}),
        MagicMock(**{"scalar_one_or_none.return_value": None}),  # user query (skip email)
    ])
    session.execute = AsyncMock(side_effect=lambda *a, **k: next(results))
    app.dependency_overrides[get_db] = _db_override(session)
    try:
        resp = await client.post("/webhooks/runpod", content=body, headers=_sign(body))
    finally:
        del app.dependency_overrides[get_db]
    assert resp.status_code == 200
    assert job.status == JobStatus.failed
    assert job.failure_code == "FILE_UNREADABLE"
    assert job.failure_class == FailureClass.user_content
