"""make_idempotency_job_id_nullable

Revision ID: 926668407981
Revises: 18e39188719b
Create Date: 2026-04-30 16:43:06.505761

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '926668407981'
down_revision: Union[str, Sequence[str], None] = '18e39188719b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("idempotency_keys", "job_id", nullable=True)


def downgrade() -> None:
    op.alter_column("idempotency_keys", "job_id", nullable=False)
