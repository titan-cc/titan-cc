"""
Download input file from S3 and convert to 16 kHz mono WAV using ffmpeg.

Error mapping:
  ffmpeg exit != 0 AND no audio stream  → FILE_NO_AUDIO_TRACK
  ffmpeg exit != 0 (anything else)      → FILE_UNREADABLE
  S3 download fails                     → S3_DOWNLOAD_FAILED
"""

import subprocess
import tempfile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from failure_codes import FailureCode, PipelineError


def download_and_convert(s3_key: str, bucket: str, s3_client: "boto3.client") -> Path:
    """
    Download s3_key and convert to 16 kHz mono WAV.
    Returns path to the WAV file (caller is responsible for cleanup).
    """
    suffix = Path(s3_key).suffix or ".bin"
    tmp_input = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_input.close()
    tmp_wav.close()

    # 1. Download
    try:
        s3_client.download_file(bucket, s3_key, tmp_input.name)
    except ClientError as exc:
        raise PipelineError(
            FailureCode.S3_DOWNLOAD_FAILED,
            f"S3 download failed: {exc}",
            {"s3_key": s3_key},
        ) from exc

    # 2. Convert with ffmpeg
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_input.name,
                "-ar", "16000",
                "-ac", "1",
                "-f", "wav",
                tmp_wav.name,
            ],
            capture_output=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired as exc:
        raise PipelineError(FailureCode.FILE_UNREADABLE, "ffmpeg timed out") from exc

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        if "audio" in stderr.lower() and (
            "stream" in stderr.lower() or "no such" in stderr.lower()
        ):
            raise PipelineError(
                FailureCode.FILE_NO_AUDIO_TRACK,
                "No audio stream found in file",
                {"ffmpeg_stderr": stderr[:500]},
            )
        raise PipelineError(
            FailureCode.FILE_UNREADABLE,
            f"ffmpeg exited {result.returncode}",
            {"ffmpeg_stderr": stderr[:500]},
        )

    return Path(tmp_wav.name)
