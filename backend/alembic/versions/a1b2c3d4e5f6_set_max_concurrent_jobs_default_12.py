"""set max_concurrent_jobs default 12

Revision ID: a1b2c3d4e5f6
Revises: c4f8a2b1d9e0
Create Date: 2026-05-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "c4f8a2b1d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "quotas",
        "max_concurrent_jobs",
        existing_type=sa.Integer(),
        server_default="12",
        existing_nullable=False,
    )
    op.execute("UPDATE quotas SET max_concurrent_jobs = 12")


def downgrade() -> None:
    op.alter_column(
        "quotas",
        "max_concurrent_jobs",
        existing_type=sa.Integer(),
        server_default="2",
        existing_nullable=False,
    )
    op.execute("UPDATE quotas SET max_concurrent_jobs = 2")
