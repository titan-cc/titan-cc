"""merge f3a1b2c4d5e6 and a1b2c3d4e5f6 heads

Revision ID: b9c8d7e6f5a4
Revises: f3a1b2c4d5e6, a1b2c3d4e5f6
Create Date: 2026-05-01

"""
from typing import Sequence, Union

revision: str = 'b9c8d7e6f5a4'
down_revision: Union[str, Sequence[str], None] = ('f3a1b2c4d5e6', 'a1b2c3d4e5f6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
