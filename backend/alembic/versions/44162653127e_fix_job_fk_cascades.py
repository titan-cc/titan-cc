"""fix_job_fk_cascades

Revision ID: 44162653127e
Revises: b9c8d7e6f5a4
Create Date: 2026-05-04

Add ON DELETE CASCADE to idempotency_keys.job_id and ON DELETE SET NULL to
notifications.job_id so that deleting a job (e.g. via folder cascade) does
not raise a FK constraint violation.
"""
from __future__ import annotations

from alembic import op

revision = "44162653127e"
down_revision = "b9c8d7e6f5a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("idempotency_keys_job_id_fkey", "idempotency_keys", type_="foreignkey")
    op.create_foreign_key(
        "idempotency_keys_job_id_fkey",
        "idempotency_keys", "jobs",
        ["job_id"], ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("notifications_job_id_fkey", "notifications", type_="foreignkey")
    op.create_foreign_key(
        "notifications_job_id_fkey",
        "notifications", "jobs",
        ["job_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("notifications_job_id_fkey", "notifications", type_="foreignkey")
    op.create_foreign_key(
        "notifications_job_id_fkey",
        "notifications", "jobs",
        ["job_id"], ["id"],
    )

    op.drop_constraint("idempotency_keys_job_id_fkey", "idempotency_keys", type_="foreignkey")
    op.create_foreign_key(
        "idempotency_keys_job_id_fkey",
        "idempotency_keys", "jobs",
        ["job_id"], ["id"],
    )
