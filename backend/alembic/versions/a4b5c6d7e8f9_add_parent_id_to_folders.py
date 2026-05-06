"""add parent_id to folders

Revision ID: a4b5c6d7e8f9
Revises: b9c8d7e6f5a4
Create Date: 2026-05-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, Sequence[str], None] = 'b9c8d7e6f5a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'folders',
        sa.Column('parent_id', UUID(as_uuid=True), sa.ForeignKey('folders.id', ondelete='CASCADE'), nullable=True),
    )
    op.create_index(
        'idx_folders_parent',
        'folders',
        ['parent_id'],
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index('idx_folders_parent', table_name='folders')
    op.drop_column('folders', 'parent_id')
