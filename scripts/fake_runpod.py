#!/usr/bin/env python3
"""
Fake RunPod server — Phase 4 local testing.

Accepts dispatched jobs, simulates GPU processing, then POSTs webhooks
back to the backend using the same HMAC scheme as the real handler.

Usage (from titan-cc/backend/):
    PYTHONPATH=. python ../scripts/fake_runpod.py

Or set env vars:
    RUNPOD_WEBHOOK_SECRET=dev-secret
    FAKE_RUNPOD_PORT=9000
    API_BASE_URL=http://localhost:8000
"""

import asyncio
import hashlib
import hmac as _hmac
import json
import os
import time
import uuid

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

WEBHOOK_SECRET = os.getenv("RUNPOD_WEBHOOK_SECRET", "dev-secret")
PORT = int(os.getenv("FAKE_RUNPOD_PORT", "9000"))

app = FastAPI(title="Fake RunPod")


def _sign(body: bytes) -> dict[str, str]:
    """Sign a webhook body, returning the three HMAC headers."""
    ts = str(time.time())
    nonce = str(uuid.uuid4())
    message = f"{ts}.{nonce}.".encode() + body
    sig = _hmac.new(WEBHOOK_SECRET.encode(), message, hashlib.sha256).hexdigest()
    return {
        "X-Runpod-Signature": f"sha256={sig}",
        "X-Runpod-Timestamp": ts,
        "X-Runpod-Nonce": nonce,
        "Content-Type": "application/json",
    }


async def _post_webhook(webhook_url: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    headers = _sign(body)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(webhook_url, content=body, headers=headers)
    print(f"  → {payload['event']:10s} [{resp.status_code}]")


async def _simulate_job(webhook_url: str, job_id: str, claim_token: str) -> None:
    """Walk a job through started → progress → completed, mimicking real GPU timing."""
    base = {"job_id": job_id, "claim_token": claim_token, "timestamp": str(time.time())}

    await asyncio.sleep(1)
    await _post_webhook(webhook_url, {**base, "event": "started", "payload": {}})

    await asyncio.sleep(3)
    await _post_webhook(webhook_url, {**base, "event": "progress", "payload": {
        "current_stage": "transcribing",
        "progress_pct": 50,
    }})

    await asyncio.sleep(3)
    await _post_webhook(webhook_url, {**base, "event": "completed", "payload": {
        "output_s3_keys": {
            "json": f"outputs/{job_id}/transcript.json",
            "srt":  f"outputs/{job_id}/transcript.srt",
            "txt":  f"outputs/{job_id}/transcript.txt",
        },
        "cost_usd": 0.003,
        "input_hash": "fakehash-" + job_id[:8],
    }})


@app.post("/")
async def dispatch(request: Request) -> JSONResponse:
    data = await request.json()
    inp = data.get("input", {})
    job_id = inp.get("job_id", "unknown")
    claim_token = inp.get("claim_token", "")
    webhook_url = inp.get("webhook_url", "")

    print(f"\n[fake-runpod] job {job_id[:8]}… dispatched → simulating ~7s pipeline")
    asyncio.create_task(_simulate_job(webhook_url, job_id, claim_token))
    return JSONResponse({"id": job_id, "status": "IN_QUEUE"})


if __name__ == "__main__":
    print(f"[fake-runpod] listening on :{PORT}  secret={WEBHOOK_SECRET!r}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
