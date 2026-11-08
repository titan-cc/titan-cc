"""add vocabulary_terms (team word list)

Revision ID: e7f8a9b0c1d2
Revises: d4e5f6a7b8c9
Create Date: 2026-11-08 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e7f8a9b0c1d2"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vocabulary_terms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("term", sa.Text(), nullable=False, unique=True),
        sa.Column("kind", sa.Text(), nullable=False, server_default="term"),
        sa.Column("mode", sa.Text(), nullable=False, server_default="hint"),
        sa.Column("variants", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("clues", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("confirmations", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_vocabulary_terms_created_by"),
            nullable=True,
        ),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("mode IN ('fix', 'context', 'hint')", name="ck_vocabulary_terms_mode"),
    )


def downgrade() -> None:
    op.drop_table("vocabulary_terms")
