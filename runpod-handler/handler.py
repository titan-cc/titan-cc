"""
RunPod serverless entry point for Titan CC transcription.

Flow per job:
  1. Download input from S3 + convert to 16 kHz WAV (ffmpeg)
  2. Voice Activity Detection (Silero VAD)
  3. Transcription (faster-whisper large-v3)
  4. (Optional) Speaker diarization (WhisperX)
  5. Format outputs (JSON, SRT, TXT)
  6. Upload outputs to S3
  7. POST completed webhook to backend

On any PipelineError → POST failed webhook.
On unexpected crash  → POST failed/WORKER_CRASHED webhook.
"""

from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import logging
import os
import tempfile
import time
import traceback
import uuid
from pathlib import Path

import boto3
import httpx
import runpod

from failure_codes import FailureClass, FailureCode, PipelineError
from pipeline.audio import download_and_convert
from pipeline.vad import get_speech_segments
from pipeline.transcribe import transcribe
from pipeline.align import diarize
from pipeline.format import write_outputs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("titan-handler")

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


def _post_webhook(url: str, payload: dict, secret: str) -> None:
    body = json.dumps(payload).encode()
    headers = _sign_headers(body, secret)
    with httpx.Client(timeout=15) as client:
        resp = client.post(url, content=body, headers=headers)
        resp.raise_for_status()


def _send_progress(
    url: str, job_id: str, claim_token: str, stage: str, pct: int, secret: str
) -> None:
    _post_webhook(url, {
        "job_id": job_id,
        "claim_token": claim_token,
        "event": "progress",
        "timestamp": str(time.time()),
        "payload": {"current_stage": stage, "progress_pct": pct},
    }, secret)


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
        try:
            _send_progress(webhook_url, job_id, claim_token, stage, pct, webhook_secret)
        except Exception as exc:
            logger.warning("progress_webhook_failed: %s", exc)

    tmpdir = Path(tempfile.mkdtemp())

    try:
        # ── Stage 1: Download + convert ────────────────────────────────────────
        progress("downloading", 5)
        wav_path = download_and_convert(s3_key, S3_BUCKET, _s3)
        logger.info("audio_converted: %s → %s", s3_key, wav_path)

        # ── Stage 2: VAD ───────────────────────────────────────────────────────
        progress("vad", 20)
        get_speech_segments(str(wav_path))  # raises if too quiet
        logger.info("vad_ok")

        # ── Stage 3: Transcribe ────────────────────────────────────────────────
        progress("transcribing", 35)
        segments = transcribe(str(wav_path), language=config.get("language", "auto"))
        logger.info("transcribed: %d segments", len(segments))

        # ── Stage 4: Diarize (optional) ────────────────────────────────────────
        if config.get("enable_diarization"):
            progress("diarizing", 70)
            segments = diarize(segments, str(wav_path))

        # ── Stage 5: Format ────────────────────────────────────────────────────
        progress("formatting", 85)
        output_formats: list[str] = config.get("output_formats", ["json", "srt", "txt"])
        paths = write_outputs(segments, job_id, out_dir=tmpdir)

        # ── Stage 6: Upload ────────────────────────────────────────────────────
        progress("uploading", 92)
        output_keys: dict[str, str] = {}
        for fmt, path in paths.items():
            if fmt in output_formats:
                s3_out_key = f"outputs/{job_id}/{path.name}"
                _s3.upload_file(str(path), S3_BUCKET, s3_out_key)
                output_keys[fmt] = s3_out_key
        logger.info("outputs_uploaded: %s", list(output_keys))

        # ── Compute input hash for deduplication ───────────────────────────────
        input_hash = hashlib.sha256(wav_path.read_bytes()).hexdigest()

        _send_completed(
            webhook_url, job_id, claim_token,
            output_keys, 0.0, input_hash, webhook_secret,
        )
        logger.info("job_completed: %s", job_id)
        return {"status": "completed", "job_id": job_id}

    except PipelineError as exc:
        logger.error("pipeline_error: %s %s", exc.code, exc)
        _send_failed(
            webhook_url, job_id, claim_token,
            exc.failure_class.value, exc.code.value, exc.user_message,
            {"detail": str(exc), **exc.extra}, webhook_secret,
        )
        return {"status": "failed", "failure_code": exc.code.value}

    except Exception as exc:
        tb = traceback.format_exc()
        logger.exception("unexpected_crash: %s", exc)
        _send_failed(
            webhook_url, job_id, claim_token,
            FailureClass.system_permanent.value,
            FailureCode.WORKER_CRASHED.value,
            "Something went wrong on our end.",
            {"traceback": tb[:2000]},
            webhook_secret,
        )
        return {"status": "failed", "failure_code": "WORKER_CRASHED"}

    finally:
        # Clean up local temp files
        import shutil
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


# Pre-load Whisper model into GPU memory before accepting any jobs.
# This pays the 60-90s model-load cost at container startup, not on the
# first job — so every job sees a warm model regardless of cold start.
logger.info("preloading_model")
try:
    from pipeline.transcribe import _load_model
    _load_model()
    logger.info("model_preloaded")
except Exception as _exc:
    logger.warning("model_preload_failed", error=str(_exc))

runpod.serverless.start({"handler": handler})
