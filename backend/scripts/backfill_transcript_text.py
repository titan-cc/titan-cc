"""
One-time backfill: populate transcript_text for completed jobs where it is NULL.

Run via:
  cd backend && railway run python scripts/backfill_transcript_text.py
"""

import asyncio
import os

import boto3
from botocore.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

DATABASE_URL = os.environ["DATABASE_URL"]
S3_BUCKET = os.environ["S3_BUCKET"]

_s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION", "ap-south-1"),
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    config=Config(signature_version="s3v4"),
)


def fetch_txt(s3_key: str, max_bytes: int = 5_000_000) -> str:
    obj = _s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
    return obj["Body"].read(max_bytes).decode("utf-8", errors="replace")


async def main() -> None:
    engine = create_async_engine(DATABASE_URL, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        rows = (await db.execute(text(
            "SELECT id, output_s3_keys FROM jobs "
            "WHERE status = 'completed' AND transcript_text IS NULL AND output_s3_keys IS NOT NULL"
        ))).all()

    await engine.dispose()
    print(f"Found {len(rows)} completed jobs with no transcript_text")

    if not rows:
        return

    engine = create_async_engine(DATABASE_URL, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    ok = 0
    fail = 0
    for row in rows:
        job_id, output_s3_keys = row[0], row[1]

        if not isinstance(output_s3_keys, dict):
            print(f"  SKIP {job_id}: output_s3_keys is {type(output_s3_keys)}")
            fail += 1
            continue

        txt_key = output_s3_keys.get("txt")
        if not txt_key:
            print(f"  SKIP {job_id}: no txt key in {list(output_s3_keys)}")
            fail += 1
            continue

        try:
            transcript = fetch_txt(txt_key)
            async with Session() as db:
                await db.execute(text(
                    "UPDATE jobs SET transcript_text = :t, updated_at = NOW() WHERE id = :id"
                ), {"t": transcript, "id": str(job_id)})
                await db.commit()
            print(f"  OK  {job_id}: {len(transcript)} chars")
            ok += 1
        except Exception as exc:
            print(f"  ERR {job_id}: {exc}")
            fail += 1

    await engine.dispose()
    print(f"\nDone — {ok} updated, {fail} skipped/failed.")


if __name__ == "__main__":
    asyncio.run(main())
