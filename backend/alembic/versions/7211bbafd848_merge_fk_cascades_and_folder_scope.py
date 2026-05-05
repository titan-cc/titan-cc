"""merge_fk_cascades_and_folder_scope

Revision ID: 7211bbafd848
Revises: 224d342d28ef, 44162653127e
Create Date: 2026-05-05 12:04:32.681670

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7211bbafd848'
down_revision: Union[str, Sequence[str], None] = ('224d342d28ef', '44162653127e')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
