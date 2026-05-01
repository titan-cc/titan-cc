"""add_admin_fields_to_users

Revision ID: c4f8a2b1d9e0
Revises: 801f6206ffe7
Create Date: 2026-05-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4f8a2b1d9e0'
down_revision: Union[str, Sequence[str], None] = '801f6206ffe7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role", sa.Text(), nullable=False, server_default="user"))
    op.add_column("users", sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("users", sa.Column("access_level", sa.Text(), nullable=False, server_default="basic"))


def downgrade() -> None:
    op.drop_column("users", "access_level")
    op.drop_column("users", "is_enabled")
    op.drop_column("users", "role")
