import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, case, func, or_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_admin
from app.models import Folder, Job, User
from app.schemas import FolderCreateRequest, FolderListResponse, FolderUpdateRequest, FolderResponse

router = APIRouter()

_VALID_SCOPES = {"personal", "org"}


def _to_response(folder: Folder, job_count: int, user_id: uuid.UUID) -> FolderResponse:
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        scope=folder.scope,
        owned_by_me=folder.user_id == user_id,
        created_at=folder.created_at,
        job_count=job_count,
    )


async def _get_folder_or_404(folder_id: uuid.UUID, db: AsyncSession) -> Folder:
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    return folder


def _can_modify(folder: Folder, user: User) -> bool:
    """Owner or admin can rename/change scope."""
    return folder.user_id == user.id or user.role == "admin"


@router.get("", response_model=FolderListResponse)
async def list_folders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderListResponse:
    # Personal folders owned by this user + all org-scoped folders.
    # For personal folders: count only the caller's jobs.
    # For org folders: count all users' jobs (org folders are shared).
    rows = await db.execute(
        select(
            Folder,
            func.count(
                case(
                    (and_(Folder.scope == "personal", Job.user_id == user.id), Job.id),
                    (Folder.scope == "org", Job.id),
                    else_=None,
                )
            ).label("job_count"),
        )
        .outerjoin(Job, Job.folder_id == Folder.id)
        .where(
            or_(
                and_(Folder.user_id == user.id, Folder.scope == "personal"),
                Folder.scope == "org",
            )
        )
        .group_by(Folder.id)
        .order_by(Folder.scope.asc(), Folder.created_at.asc())
    )
    folders = [_to_response(f, count, user.id) for f, count in rows]
    return FolderListResponse(folders=folders)


@router.post("", response_model=FolderResponse, status_code=201)
async def create_folder(
    body: FolderCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    if body.scope not in _VALID_SCOPES:
        raise HTTPException(status_code=422, detail="scope must be 'personal' or 'org'")

    # Duplicate name check: personal = per-user; org = global
    if body.scope == "personal":
        clash_filter = and_(Folder.user_id == user.id, Folder.scope == "personal", Folder.name == body.name)
    else:
        clash_filter = and_(Folder.scope == "org", Folder.name == body.name)

    existing = (await db.execute(select(Folder).where(clash_filter))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A folder with that name already exists")

    folder = Folder(user_id=user.id, name=body.name, scope=body.scope)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return _to_response(folder, 0, user.id)


@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: uuid.UUID,
    body: FolderUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    folder = await _get_folder_or_404(folder_id, db)

    if not _can_modify(folder, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to modify this folder")

    if body.scope is not None and body.scope not in _VALID_SCOPES:
        raise HTTPException(status_code=422, detail="scope must be 'personal' or 'org'")

    new_name = body.name or folder.name
    new_scope = body.scope or folder.scope

    # Clash check when renaming or changing scope
    if new_name != folder.name or new_scope != folder.scope:
        if new_scope == "personal":
            clash_filter = and_(
                Folder.user_id == user.id, Folder.scope == "personal",
                Folder.name == new_name, Folder.id != folder_id,
            )
        else:
            clash_filter = and_(
                Folder.scope == "org", Folder.name == new_name, Folder.id != folder_id,
            )
        if (await db.execute(select(Folder).where(clash_filter))).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="A folder with that name already exists")

    folder.name = new_name
    folder.scope = new_scope
    folder.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(folder)

    count_q = select(func.count(Job.id)).where(Job.folder_id == folder.id)
    if folder.scope == "personal":
        count_q = count_q.where(Job.user_id == user.id)
    job_count = (await db.execute(count_q)).scalar_one()
    return _to_response(folder, job_count, user.id)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: uuid.UUID,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    folder = await _get_folder_or_404(folder_id, db)
    await db.execute(delete(Folder).where(Folder.id == folder.id))
    await db.commit()
