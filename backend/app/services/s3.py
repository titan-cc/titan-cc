import re
import uuid
from datetime import UTC, datetime, timedelta

import boto3
from botocore.config import Config

from app.config import settings

ALLOWED_CONTENT_TYPES = frozenset({
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/flac", "audio/m4a", "audio/aac",
    "audio/mp4", "audio/webm",
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/webm", "video/x-matroska",
})

_PRESIGN_TTL_GET = 300        # 5 minutes — download links
_PRESIGN_TTL_PUT_MIN = 3600   # 1 hour minimum for uploads
_BYTES_PER_SECOND = 2_500_000 # assume ~20 Mbps — slow Indian broadband


def _client() -> "boto3.client":
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        config=Config(signature_version="s3v4"),
    )


def _upload_ttl(size_bytes: int) -> int:
    """TTL long enough to upload size_bytes at assumed minimum bandwidth, minimum 1 hour."""
    needed = (size_bytes // _BYTES_PER_SECOND) + 300  # transfer time + 5 min buffer
    return max(_PRESIGN_TTL_PUT_MIN, needed)


def presign_post(
    user_id: uuid.UUID,
    filename: str,
    content_type: str,
    size_bytes: int,
) -> tuple[str, dict[str, str], str, datetime]:
    """Return (upload_url, form_fields, s3_key, expires_at).

    Uses generate_presigned_post rather than generate_presigned_url("put_object")
    so that a ContentLengthRange condition can be embedded in the signed policy.
    S3 enforces the range server-side — a client cannot bypass it by sending a
    larger file even if they hold a valid presigned URL.

    The caller must POST multipart/form-data with all form_fields first,
    then append the file as the last field named "file".
    """
    safe = re.sub(r"[^\w.\-]", "_", filename)[:200]
    s3_key = f"inputs/{user_id}/{uuid.uuid4()}/{safe}"
    ttl = _upload_ttl(size_bytes)
    resp = _client().generate_presigned_post(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            # Enforce declared size at S3 level. Allow ±1 byte tolerance for
            # rounding; upper bound is the size declared in the presign request.
            ["content-length-range", 1, size_bytes],
        ],
        ExpiresIn=ttl,
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=ttl)
    return resp["url"], dict(resp["fields"]), s3_key, expires_at


def presign_get(s3_key: str, expires_in: int = _PRESIGN_TTL_GET) -> tuple[str, datetime]:
    """Return (download_url, expires_at)."""
    url = _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key},
        ExpiresIn=expires_in,
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    return url, expires_at


def put_bytes(s3_key: str, body: bytes, content_type: str) -> None:
    """Upload raw bytes directly to an S3 key, overwriting any existing object."""
    _client().put_object(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        Body=body,
        ContentType=content_type,
    )


def get_text(s3_key: str, max_bytes: int = 5_000_000) -> str:
    """Download a text object from S3 and return its content as a string.

    Capped at max_bytes to prevent unbounded memory usage on huge transcripts.
    """
    obj = _client().get_object(Bucket=settings.s3_bucket, Key=s3_key)
    return obj["Body"].read(max_bytes).decode("utf-8", errors="replace")
