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

_PRESIGN_TTL = 300  # 5 minutes


def _client() -> "boto3.client":
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        config=Config(signature_version="s3v4"),
    )


def presign_put(
    user_id: uuid.UUID,
    filename: str,
    content_type: str,
    size_bytes: int,  # noqa: ARG001 — validated upstream; stored for future use
) -> tuple[str, str, datetime]:
    """Return (upload_url, s3_key, expires_at). Content-type is locked into the signed URL."""
    safe = re.sub(r"[^\w.\-]", "_", filename)[:200]
    s3_key = f"inputs/{user_id}/{uuid.uuid4()}/{safe}"
    url = _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=_PRESIGN_TTL,
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=_PRESIGN_TTL)
    return url, s3_key, expires_at


def presign_get(s3_key: str, expires_in: int = _PRESIGN_TTL) -> tuple[str, datetime]:
    """Return (download_url, expires_at)."""
    url = _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key},
        ExpiresIn=expires_in,
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    return url, expires_at
