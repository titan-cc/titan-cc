"""
RunPod serverless entry point for Titan CC transcription.

Flow per job:
  1. Download input from S3 + convert to 16 kHz WAV (ffmpeg)
  2. Voice Activity Detection (Silero VAD)
  3. Transcription (faster-whisper medium)
  4. (Optional) Speaker diarization (WhisperX)
  5. Format outputs (JSON, SRT, TXT)
  6. Upload outputs to S3
  7. POST completed/failed webhook to backend
     └─ If all retries exhausted → write dead-letter to S3 instead of silently dropping

On any PipelineError → POST failed webhook.
On unexpected crash  → POST failed/WORKER_CRASHED webhook.
"""

from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import traceback
import uuid
from pathlib import Path

import boto3
from tenacity import retry, stop_after_attempt, wait_exponential

from failure_codes import FailureClass, FailureCode, PipelineError
from pipeline.audio import download_and_convert
from pipeline.vad import get_speech_segments
from pipeline.transcribe import transcribe
from pipeline.align import diarize
from pipeline.format import write_outputs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("titan-handler")


# ── Startup diagnostics ────────────────────────────────────────────────────────

def _log_startup_env() -> None:
    try:
        import torch
        cuda_ok = torch.cuda.is_available()
        logger.info("startup: cuda_available=%s torch=%s", cuda_ok, torch.__version__)
        if cuda_ok:
            props = torch.cuda.get_device_properties(0)
            vram_gb = props.total_memory / 1e9
            logger.info(
                "startup: gpu=%s vram_total_gb=%.1f cuda_version=%s",
                props.name, vram_gb, torch.version.cuda,
            )
        else:
            logger.warning("startup: NO CUDA — model will run on CPU, jobs will be very slow")
    except Exception as exc:
        logger.warning("startup: could not inspect CUDA environment: %s", exc)


# ── AWS client ─────────────────────────────────────────────────────────────────

S3_BUCKET: str = os.environ["S3_BUCKET"]
_s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION", "ap-south-1"),
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
)


# ── Webhook helpers ────────────────────────────────────────────────────────────

def _sign_headers(body: bytes, secret: str) -> dict[str, str]:
    ts = str(time.time())
    nonce = str(uuid.uuid4())
    message = f"{ts}.{nonce}.".encode() + body
    sig = _hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return {
        "X-Runpod-Signature": f"sha256={sig}",
        "X-Runpod-Timestamp": ts,
        "X-Runpod-Nonce": nonce,
        "Content-Type": "application/json",
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _post_webhook(url: str, payload: dict, secret: str) -> None:
    import httpx
    body = json.dumps(payload).encode()
    headers = _sign_headers(body, secret)
    with httpx.Client(timeout=15) as client:
        resp = client.post(url, content=body, headers=headers)
        resp.raise_for_status()


def _write_dead_letter(job_id: str, payload: dict) -> None:
    """
    Last-resort persistence when all webhook retries are exhausted.

    Writes the undelivered payload to S3 at dead-letters/{job_id}.json.
    The backend can scan this prefix to recover stuck jobs, or an operator
    can inspect manually via the AWS console.
    """
    key = f"dead-letters/{job_id}.json"
    try:
        body = json.dumps({"written_at": time.time(), "payload": payload}).encode()
        _s3.put_object(Bucket=S3_BUCKET, Key=key, Body=body, ContentType="application/json")
        logger.critical(
            "dead_letter_written: job=%s s3_key=%s — "
            "backend was NOT notified; job will stay 'dispatched' until recovered",
            job_id, key,
        )
    except Exception as exc:
        # S3 is also down. Log everything we have and give up.
        logger.critical(
            "dead_letter_write_failed: job=%s s3_error=%s original_payload=%s",
            job_id, exc, json.dumps(payload)[:2000],
        )


def _send_progress(
    url: str, job_id: str, claim_token: str, stage: str, pct: int, secret: str
) -> None:
    try:
        _post_webhook(url, {
            "job_id": job_id,
            "claim_token": claim_token,
            "event": "progress",
            "timestamp": str(time.time()),
            "payload": {"current_stage": stage, "progress_pct": pct},
        }, secret)
    except Exception as exc:
        logger.warning("progress_webhook_failed after retries: %s", exc)


def _send_completed(
    url: str, job_id: str, claim_token: str,
    output_keys: dict[str, str], cost: float, input_hash: str, secret: str,
) -> None:
    _post_webhook(url, {
        "job_id": job_id,
        "claim_token": claim_token,
        "event": "completed",
        "timestamp": str(time.time()),
        "payload": {
            "output_s3_keys": output_keys,
            "cost_usd": cost,
            "input_hash": input_hash,
        },
    }, secret)


def _send_failed(
    url: str, job_id: str, claim_token: str,
    failure_class: str, failure_code: str, failure_message: str,
    details: dict, secret: str,
) -> None:
    _post_webhook(url, {
        "job_id": job_id,
        "claim_token": claim_token,
        "event": "failed",
        "timestamp": str(time.time()),
        "payload": {
            "failure_class": failure_class,
            "failure_code": failure_code,
            "failure_message": failure_message,
            "failure_details": details,
        },
    }, secret)


# ── Core handler ───────────────────────────────────────────────────────────────

def handler(job: dict) -> dict:
    inp: dict = job["input"]
    job_id: str = inp["job_id"]
    claim_token: str = inp["claim_token"]
    s3_key: str = inp["s3_key"]
    config: dict = inp.get("config", {})
    webhook_url: str = inp["webhook_url"]
    webhook_secret: str = inp["webhook_secret"]

    def progress(stage: str, pct: int) -> None:
        _send_progress(webhook_url, job_id, claim_token, stage, pct, webhook_secret)

    # ── Phase 1: Pipeline ──────────────────────────────────────────────────────
    # Run every stage and record the outcome. No webhook calls happen here.
    # Cleanup is guaranteed by the finally block regardless of outcome.
    # This separation ensures webhook delivery failures can't corrupt the
    # pipeline result or cause the wrong webhook to be sent.

    pipeline_ok = False
    completed_payload: dict = {}
    failed_payload: dict = {}

    tmpdir = Path(tempfile.mkdtemp(prefix=f"titan-{job_id[:8]}-"))
    try:
        progress("downloading", 5)
        wav_path = download_and_convert(s3_key, S3_BUCKET, _s3, tmp_dir=tmpdir)
        logger.info("audio_converted: job=%s key=%s", job_id, s3_key)

        progress("vad", 20)
        get_speech_segments(str(wav_path))
        logger.info("vad_ok: job=%s", job_id)

        progress("transcribing", 35)
        segments = transcribe(str(wav_path))
        logger.info("transcribed: job=%s segments=%d", job_id, len(segments))

        if config.get("enable_diarization"):
            progress("diarizing", 70)
            segments = diarize(segments, str(wav_path))

        progress("formatting", 85)
        output_formats: list[str] = config.get("output_formats", ["json", "srt", "txt"])
        paths = write_outputs(segments, job_id, out_dir=tmpdir)

        progress("uploading", 92)
        output_keys: dict[str, str] = {}
        for fmt, path in paths.items():
            if fmt in output_formats:
                s3_out_key = f"outputs/{job_id}/{path.name}"
                _s3.upload_file(str(path), S3_BUCKET, s3_out_key)
                output_keys[fmt] = s3_out_key
        logger.info("outputs_uploaded: job=%s formats=%s", job_id, list(output_keys))

        pipeline_ok = True
        completed_payload = {
            "output_s3_keys": output_keys,
            "cost_usd": 0.0,
            "input_hash": _hash_file(wav_path),
        }

    except PipelineError as exc:
        logger.error("pipeline_error: job=%s code=%s msg=%s", job_id, exc.code, exc)
        failed_payload = {
            "failure_class": exc.failure_class.value,
            "failure_code": exc.code.value,
            "failure_message": exc.user_message,
            "failure_details": {"detail": str(exc), **exc.extra},
        }

    except Exception as exc:
        tb = traceback.format_exc()
        logger.exception("unexpected_crash: job=%s error=%s", job_id, exc)
        failed_payload = {
            "failure_class": FailureClass.system_permanent.value,
            "failure_code": FailureCode.WORKER_CRASHED.value,
            "failure_message": "Something went wrong on our end.",
            "failure_details": {"traceback": tb[:2000]},
        }

    finally:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass

    # ── Phase 2: Webhook delivery ──────────────────────────────────────────────
    # Each send has its own try/except so a delivery failure falls back to the
    # S3 dead-letter rather than silently dropping the outcome.

    if pipeline_ok:
        try:
            _send_completed(
                webhook_url, job_id, claim_token,
                completed_payload["output_s3_keys"],
                completed_payload["cost_usd"],
                completed_payload["input_hash"],
                webhook_secret,
            )
            logger.info("job_completed: %s", job_id)
        except Exception as exc:
            logger.critical("completed_webhook_exhausted: job=%s error=%s", job_id, exc)
            _write_dead_letter(job_id, {
                "job_id": job_id,
                "claim_token": claim_token,
                "event": "completed",
                "timestamp": str(time.time()),
                "payload": completed_payload,
            })
        return {"status": "completed", "job_id": job_id}

    else:
        try:
            _send_failed(
                webhook_url, job_id, claim_token,
                failed_payload["failure_class"],
                failed_payload["failure_code"],
                failed_payload["failure_message"],
                failed_payload["failure_details"],
                webhook_secret,
            )
            logger.info("job_failed: job=%s code=%s", job_id, failed_payload["failure_code"])
        except Exception as exc:
            logger.critical("failed_webhook_exhausted: job=%s error=%s", job_id, exc)
            _write_dead_letter(job_id, {
                "job_id": job_id,
                "claim_token": claim_token,
                "event": "failed",
                "timestamp": str(time.time()),
                "payload": failed_payload,
            })
        return {"status": "failed", "failure_code": failed_payload.get("failure_code", "WORKER_CRASHED")}


def _hash_file(path: Path, chunk_size: int = 1 << 20) -> str:
    """SHA-256 streamed in chunks — avoids loading a 230 MB WAV into RAM."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


# ── Worker startup ─────────────────────────────────────────────────────────────
# Pre-load both models and warm up CUDA kernels before accepting any jobs.
# If this fails the container exits non-zero and RunPod will not route jobs here.

_log_startup_env()

logger.info("preloading_models")
try:
    from pipeline.transcribe import _load_model as _load_whisper, warmup as _warmup_whisper
    from pipeline.vad import preload as _preload_vad

    _preload_vad()
    logger.info("vad_model_loaded")

    _load_whisper()
    logger.info("whisper_model_loaded")

    try:
        _warmup_whisper()
        logger.info("whisper_warmup_complete — worker ready")
    except Exception as _warmup_exc:
        # Warmup is a performance optimisation, not a correctness requirement.
        # A failed warmup means the first real job may be slower, but the
        # worker should still accept jobs rather than crash-looping.
        logger.warning("warmup_failed (non-fatal, continuing): %s", _warmup_exc)

except Exception as _exc:
    logger.exception("model_preload_failed: %s", _exc)
    sys.exit(1)

import runpod
runpod.serverless.start({"handler": handler})
