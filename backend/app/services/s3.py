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


def presign_put(
    user_id: uuid.UUID,
    filename: str,
    content_type: str,
    size_bytes: int,
) -> tuple[str, str, datetime]:
    """Return (upload_url, s3_key, expires_at). Content-type is locked into the signed URL."""
    safe = re.sub(r"[^\w.\-]", "_", filename)[:200]
    s3_key = f"inputs/{user_id}/{uuid.uuid4()}/{safe}"
    ttl = _upload_ttl(size_bytes)
    url = _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=ttl,
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=ttl)
    return url, s3_key, expires_at


def presign_get(s3_key: str, expires_in: int = _PRESIGN_TTL_GET) -> tuple[str, datetime]:
    """Return (download_url, expires_at)."""
    url = _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key},
        ExpiresIn=expires_in,
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    return url, expires_at
