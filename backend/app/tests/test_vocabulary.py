"""
Team word list: rules, API and the payload sent to the worker.

API tests use the local Postgres from backend/.env and are skipped when it is not running.
"""

import uuid

import pytest
from sqlalchemy import delete, text

from app.db import async_session_factory, engine
from app.deps import get_current_user, require_admin
from app.main import app
from app.models import User, VocabularyTerm
from app.services import vocabulary as vocab


def test_everyday_words_are_never_auto_corrected():
    assert vocab.is_common("big") and vocab.is_common("BIG,") and vocab.is_common("Lever.")
    assert not vocab.is_common("Anthano")
    assert vocab.mode_for_new_spelling("BIG") == "context"
    assert vocab.mode_for_new_spelling("Anthano") == "fix"
    assert vocab.check_variants_for_mode("fix", ["Anthano", "big"]) is not None
    assert vocab.check_variants_for_mode("context", ["big"]) is None


async def _db_ready() -> bool:
    await engine.dispose()  # each test has its own event loop; drop pooled connections
    try:
        async with async_session_factory() as db:
            await db.execute(text("SELECT 1 FROM vocabulary_terms LIMIT 1"))
        return True
    except Exception:
        return False


@pytest.fixture
async def admin_client(client):
    if not await _db_ready():
        pytest.skip("local Postgres with vocabulary_terms is not available")
    uid = uuid.uuid4()
    async with async_session_factory() as db:
        await db.execute(delete(VocabularyTerm))
        db.add(User(id=uid, clerk_user_id=f"test_{uid}", email="t@example.com", role="admin"))
        await db.commit()
        user = await db.get(User, uid)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_admin] = lambda: user
    yield client
    app.dependency_overrides.clear()
    async with async_session_factory() as db:
        await db.execute(delete(VocabularyTerm))
        await db.execute(delete(User).where(User.id == uid))
        await db.commit()


async def test_remember_learns_names_and_keeps_sound_alikes_safe(admin_client):
    r = await admin_client.post("/vocabulary/remember", json={"term": "Antano", "heard_as": "Anthano"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "fix" and r.json()["variants"] == ["Anthano"]

    r = await admin_client.post("/vocabulary/remember", json={"term": "Antano", "heard_as": "Antanu"})
    assert r.json()["variants"] == ["Anthano", "Antanu"] and r.json()["confirmations"] == 2

    r = await admin_client.post("/vocabulary/remember", json={"term": "B!G", "heard_as": "BIG"})
    assert r.json()["mode"] == "context"

    async with async_session_factory() as db:
        payload = await vocab.worker_payload(db)
    assert payload["hints"][0] == "Antano"
    assert payload["fix"] == [{"term": "Antano", "variants": ["Anthano", "Antanu"]}]
    assert payload["context"][0]["term"] == "B!G"


async def test_admin_edits_and_guardrails(admin_client):
    r = await admin_client.post("/vocabulary", json={"term": "SLDCI", "kind": "programme", "mode": "fix", "variants": ["S L D C I"]})
    assert r.status_code == 201, r.text
    term_id = r.json()["id"]

    r = await admin_client.post("/vocabulary", json={"term": "SLDCI"})
    assert r.status_code == 409

    r = await admin_client.patch(f"/vocabulary/{term_id}", json={"variants": ["big"]})
    assert r.status_code == 422 and "everyday word" in r.json()["detail"]

    r = await admin_client.patch(f"/vocabulary/{term_id}", json={"mode": "context", "variants": ["big"], "clues": ["cohort"]})
    assert r.status_code == 200 and r.json()["clues"] == ["cohort"]

    assert (await admin_client.get("/vocabulary")).json()[0]["term"] == "SLDCI"
    assert (await admin_client.delete(f"/vocabulary/{term_id}")).status_code == 204
    assert (await admin_client.get("/vocabulary")).json() == []
