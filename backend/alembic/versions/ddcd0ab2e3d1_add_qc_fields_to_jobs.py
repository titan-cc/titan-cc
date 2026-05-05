"""add_qc_fields_to_jobs

Revision ID: ddcd0ab2e3d1
Revises: 44162653127e
Create Date: 2026-05-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ddcd0ab2e3d1"
down_revision = "44162653127e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("qc_done_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("qc_done_by_email", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "qc_done_by_email")
    op.drop_column("jobs", "qc_done_at")
