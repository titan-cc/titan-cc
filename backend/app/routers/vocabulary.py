"""
Team word list. Everyone can see it and teach it through Remember; admins edit it.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_admin
from app.models import User, VocabularyTerm
from app.services import vocabulary as vocab

router = APIRouter()

Short = Annotated[str, Field(min_length=1, max_length=vocab.MAX_LEN)]


class TermResponse(BaseModel):
    id: uuid.UUID
    term: str
    kind: str
    mode: str
    variants: list[str]
    clues: list[str]
    confirmations: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TermCreate(BaseModel):
    term: Short
    kind: Literal["person", "brand", "programme", "place", "term"] = "term"
    mode: Literal["fix", "context", "hint"] = "hint"
    variants: Annotated[list[Short], Field(max_length=vocab.MAX_VARIANTS)] = []
    clues: Annotated[list[Short], Field(max_length=vocab.MAX_CLUES)] = []


class TermUpdate(BaseModel):
    term: Short | None = None
    kind: Literal["person", "brand", "programme", "place", "term"] | None = None
    mode: Literal["fix", "context", "hint"] | None = None
    variants: Annotated[list[Short], Field(max_length=vocab.MAX_VARIANTS)] | None = None
    clues: Annotated[list[Short], Field(max_length=vocab.MAX_CLUES)] | None = None


class RememberRequest(BaseModel):
    term: Short          # the correct spelling, e.g. "Antano"
    heard_as: Short      # what Whisper wrote, e.g. "Anthano"


def _dedupe(items: list[str], exclude: str = "") -> list[str]:
    out: list[str] = []
    for item in (vocab.clean(i) for i in items):
        if item and item != exclude and item not in out:
            out.append(item)
    return out


def _bad_request(msg: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)


async def _get(db: AsyncSession, term_id: uuid.UUID) -> VocabularyTerm:
    row = await db.get(VocabularyTerm, term_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Word not found")
    return row


async def _check_room(db: AsyncSession) -> None:
    count = await db.scalar(select(func.count()).select_from(VocabularyTerm))
    if (count or 0) >= vocab.MAX_TERMS:
        raise _bad_request(f"The word list is full ({vocab.MAX_TERMS} words). Remove unused words first.")


@router.get("", response_model=list[TermResponse])
async def list_terms(
    _: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[VocabularyTerm]:
    rows = await db.execute(
        select(VocabularyTerm).order_by(VocabularyTerm.confirmations.desc(), VocabularyTerm.term)
    )
    return list(rows.scalars().all())


@router.post("/remember", response_model=TermResponse)
async def remember(
    body: RememberRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VocabularyTerm:
    """
    A person fixed `heard_as` to `term` and ticked Remember. Adds the term (or the
    new spelling to it). Everyday-word spellings become "suggest in context" rules.
    """
    term, heard = vocab.clean(body.term), vocab.clean(body.heard_as)
    if term == heard:
        raise _bad_request("The correct spelling is the same as what was heard.")

    row = (await db.execute(select(VocabularyTerm).where(VocabularyTerm.term == term))).scalar_one_or_none()
    if row is None:
        await _check_room(db)
        row = VocabularyTerm(
            term=term, kind="term", mode=vocab.mode_for_new_spelling(heard),
            variants=[], clues=[], confirmations=0, created_by=user.id,
        )
        db.add(row)
    elif row.mode == "fix" and vocab.is_common(heard):
        # Never let an everyday word into an auto-correct rule; downgrade to suggestions.
        row.mode = "context"
    elif row.mode == "hint":
        row.mode = vocab.mode_for_new_spelling(heard)

    if heard not in row.variants and len(row.variants) < vocab.MAX_VARIANTS:
        row.variants = [*row.variants, heard]
    row.confirmations = (row.confirmations or 0) + 1
    await db.commit()
    await db.refresh(row)
    return row


@router.post("", response_model=TermResponse, status_code=status.HTTP_201_CREATED)
async def create_term(
    body: TermCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> VocabularyTerm:
    term = vocab.clean(body.term)
    variants = _dedupe(body.variants, exclude=term)
    if msg := vocab.check_variants_for_mode(body.mode, variants):
        raise _bad_request(msg)
    if (await db.execute(select(VocabularyTerm).where(VocabularyTerm.term == term))).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{term}' is already in the word list")
    await _check_room(db)
    row = VocabularyTerm(
        term=term, kind=body.kind, mode=body.mode, variants=variants,
        clues=_dedupe(body.clues), confirmations=0, created_by=user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/{term_id}", response_model=TermResponse)
async def update_term(
    term_id: uuid.UUID,
    body: TermUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> VocabularyTerm:
    row = await _get(db, term_id)
    if body.term is not None:
        new_term = vocab.clean(body.term)
        clash = (await db.execute(
            select(VocabularyTerm).where(VocabularyTerm.term == new_term, VocabularyTerm.id != row.id)
        )).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{new_term}' is already in the word list")
        row.term = new_term
    if body.kind is not None:
        row.kind = body.kind
    variants = _dedupe(body.variants, exclude=row.term) if body.variants is not None else list(row.variants)
    mode = body.mode or row.mode
    if msg := vocab.check_variants_for_mode(mode, variants):
        raise _bad_request(msg)
    row.mode, row.variants = mode, variants
    if body.clues is not None:
        row.clues = _dedupe(body.clues)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_term(
    term_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    row = await _get(db, term_id)
    await db.delete(row)
    await db.commit()
