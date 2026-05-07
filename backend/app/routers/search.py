import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Folder, Job, JobStatus, User
from app.schemas import SearchHit, SearchResponse

router = APIRouter()

_MAX_RESULTS = 50


@router.get("", response_model=SearchResponse)
async def search_transcripts(
    q: str | None = Query(None, max_length=200),
    folder_id: str | None = Query(None),
    tag: str | None = Query(None, max_length=50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResponse:
    # At least one of q or tag must be provided
    if not q and not tag:
        raise HTTPException(status_code=422, detail="Provide at least one of 'q' or 'tag'")

    # Base statement — always return completed jobs with transcript text
    stmt = (
        select(
            Job.id,
            Job.input_filename,
            Job.folder_id,
            Job.tags,
            Folder.name.label("folder_name"),
            Job.created_at,
            Job.status,
        )
        .outerjoin(Folder, Folder.id == Job.folder_id)
        .where(
            Job.status == JobStatus.completed,
        )
        .order_by(Job.created_at.desc())
        .limit(_MAX_RESULTS)
    )

    # Full-text search filter
    if q:
        tsquery = func.plainto_tsquery("english", q)
        tsvector = func.to_tsvector("english", func.coalesce(Job.transcript_text, ""))
        headline = func.ts_headline(
            "english",
            func.coalesce(Job.transcript_text, ""),
            tsquery,
            text("'MaxFragments=2, MaxWords=15, MinWords=5, StartSel=<mark>, StopSel=</mark>'"),
        ).label("snippet")
        stmt = stmt.add_columns(headline)
        stmt = stmt.where(
            Job.transcript_text.isnot(None),
            tsvector.op("@@")(tsquery),
        )
    else:
        # No text search — return a placeholder snippet
        from sqlalchemy import literal
        stmt = stmt.add_columns(literal("").label("snippet"))

    # Tag filter
    if tag:
        stmt = stmt.where(Job.tags.contains([tag.strip().lower()]))

    # Folder filter
    if folder_id is not None:
        try:
            stmt = stmt.where(Job.folder_id == _uuid.UUID(folder_id))
        except ValueError:
            pass

    rows = (await db.execute(stmt)).all()

    hits = [
        SearchHit(
            job_id=row.id,
            input_filename=row.input_filename,
            folder_id=row.folder_id,
            folder_name=row.folder_name,
            snippet=row.snippet or "",
            created_at=row.created_at,
            status=row.status,
            tags=row.tags or [],
        )
        for row in rows
    ]
    return SearchResponse(hits=hits, query=q or f"#{tag}")
