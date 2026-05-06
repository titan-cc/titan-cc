"""Check which users' transcripts match a keyword."""
import asyncio
import os
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

WORD = sys.argv[1] if len(sys.argv) > 1 else "describing"


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        rows = (await db.execute(text("""
            SELECT j.id, u.email, j.input_filename,
                   to_tsvector('english', coalesce(j.transcript_text,'')) @@ plainto_tsquery('english', :q) AS matches
            FROM jobs j
            JOIN users u ON u.id = j.user_id
            WHERE j.status = 'completed' AND j.transcript_text IS NOT NULL
            ORDER BY u.email, j.created_at
        """), {"q": WORD})).all()

        for r in rows:
            tag = "HIT " if r.matches else "miss"
            print(f"  {tag} | {r.email} | {r.input_filename or str(r.id)[:8]}")

    await engine.dispose()


asyncio.run(main())
