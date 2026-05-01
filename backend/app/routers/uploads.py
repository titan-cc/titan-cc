from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import PresignRequest, PresignResponse
from app.services import s3 as s3_service
from app.services.quotas import check_quota

router = APIRouter()


@router.post("/presign", response_model=PresignResponse)
async def presign_upload(
    body: PresignRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PresignResponse:
    if body.content_type not in s3_service.ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unsupported content type: {body.content_type}",
        )

    if user.quota is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Quota not initialized")

    await check_quota(user.quota, body.duration_seconds, db)

    upload_url, s3_key, expires_at = s3_service.presign_put(
        user_id=user.id,
        filename=body.filename,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
    )
    return PresignResponse(upload_url=upload_url, s3_key=s3_key, expires_at=expires_at)
