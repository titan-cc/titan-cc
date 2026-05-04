import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_admin
from app.models import Folder, Job, User
from app.schemas import FolderCreateRequest, FolderListResponse, FolderRenameRequest, FolderResponse

router = APIRouter()


async def _get_folder_or_404(folder_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Folder:
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == user_id)
    )
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    return folder


@router.get("", response_model=FolderListResponse)
async def list_folders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderListResponse:
    rows = await db.execute(
        select(Folder, func.count(Job.id).label("job_count"))
        .outerjoin(Job, Job.folder_id == Folder.id)
        .where(Folder.user_id == user.id)
        .group_by(Folder.id)
        .order_by(Folder.created_at.asc())
    )
    folders = [
        FolderResponse(
            id=f.id,
            name=f.name,
            created_at=f.created_at,
            job_count=count,
        )
        for f, count in rows
    ]
    return FolderListResponse(folders=folders)


@router.post("", response_model=FolderResponse, status_code=201)
async def create_folder(
    body: FolderCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    # Prevent duplicate names per user
    existing = (
        await db.execute(
            select(Folder).where(Folder.user_id == user.id, Folder.name == body.name)
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A folder with that name already exists",
        )

    folder = Folder(user_id=user.id, name=body.name)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return FolderResponse(id=folder.id, name=folder.name, created_at=folder.created_at, job_count=0)


@router.patch("/{folder_id}", response_model=FolderResponse)
async def rename_folder(
    folder_id: uuid.UUID,
    body: FolderRenameRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    folder = await _get_folder_or_404(folder_id, user.id, db)

    # Check new name doesn't clash
    clash = (
        await db.execute(
            select(Folder).where(
                Folder.user_id == user.id,
                Folder.name == body.name,
                Folder.id != folder_id,
            )
        )
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A folder with that name already exists",
        )

    folder.name = body.name
    folder.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(folder)

    job_count = (
        await db.execute(select(func.count(Job.id)).where(Job.folder_id == folder.id))
    ).scalar_one()
    return FolderResponse(id=folder.id, name=folder.name, created_at=folder.created_at, job_count=job_count)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    # CASCADE on folder_id FK deletes all jobs in this folder
    await db.execute(delete(Folder).where(Folder.id == folder_id))
    await db.commit()
