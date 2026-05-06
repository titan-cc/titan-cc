from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Folder, Job, JobStatus, User
from app.schemas import SearchHit, SearchResponse

router = APIRouter()

_MAX_RESULTS = 50


@router.get("", response_model=SearchResponse)
async def search_transcripts(
    q: str = Query(..., min_length=1, max_length=200),
    folder_id: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResponse:
    tsquery = func.plainto_tsquery("english", q)
    tsvector = func.to_tsvector("english", func.coalesce(Job.transcript_text, ""))

    stmt = (
        select(
            Job.id,
            Job.input_filename,
            Job.folder_id,
            Folder.name.label("folder_name"),
            Job.created_at,
            Job.status,
            func.ts_headline(
                "english",
                func.coalesce(Job.transcript_text, ""),
                tsquery,
                text("'MaxFragments=2, MaxWords=15, MinWords=5, StartSel=<mark>, StopSel=</mark>'"),
            ).label("snippet"),
        )
        .outerjoin(Folder, Folder.id == Job.folder_id)
        .where(
            Job.status == JobStatus.completed,
            Job.transcript_text.isnot(None),
            tsvector.op("@@")(tsquery),
        )
        .order_by(Job.created_at.desc())
        .limit(_MAX_RESULTS)
    )

    if folder_id is not None:
        import uuid as _uuid
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
        )
        for row in rows
    ]
    return SearchResponse(hits=hits, query=q)
