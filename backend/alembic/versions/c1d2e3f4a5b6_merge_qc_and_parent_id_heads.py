"""merge qc fields and parent_id heads

Revision ID: c1d2e3f4a5b6
Revises: ddcd0ab2e3d1, a4b5c6d7e8f9
Create Date: 2026-05-06
"""
from typing import Sequence, Union

revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = ('ddcd0ab2e3d1', 'a4b5c6d7e8f9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
