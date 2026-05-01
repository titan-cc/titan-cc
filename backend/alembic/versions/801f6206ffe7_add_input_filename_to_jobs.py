"""add_input_filename_to_jobs

Revision ID: 801f6206ffe7
Revises: 926668407981
Create Date: 2026-05-01 08:46:13.767154

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '801f6206ffe7'
down_revision: Union[str, Sequence[str], None] = '926668407981'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("input_filename", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "input_filename")
