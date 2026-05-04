"""add_folder_scope

Revision ID: 224d342d28ef
Revises: b99f0c4c6dde
Create Date: 2026-05-04 13:40:43.547979

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '224d342d28ef'
down_revision: Union[str, Sequence[str], None] = 'b99f0c4c6dde'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("scope", sa.Text(), nullable=False, server_default="personal"),
    )
    op.create_index("idx_folders_scope", "folders", ["scope"])


def downgrade() -> None:
    op.drop_index("idx_folders_scope", table_name="folders")
    op.drop_column("folders", "scope")
