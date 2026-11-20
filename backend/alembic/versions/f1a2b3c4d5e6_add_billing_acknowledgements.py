"""add billing_acknowledgements (Mark as paid for billing alerts)

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2
Create Date: 2026-11-20 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "e7f8a9b0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "billing_acknowledgements",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("invoice_id", sa.Text(), nullable=False),
        sa.Column(
            "acknowledged_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_billing_ack_user"),
            nullable=True,
        ),
        sa.Column("acknowledged_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("uq_billing_ack_provider_invoice", "billing_acknowledgements", ["provider", "invoice_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_billing_ack_provider_invoice", table_name="billing_acknowledgements")
    op.drop_table("billing_acknowledgements")
