"""add runpod_job_id to jobs

Revision ID: f3a1b2c4d5e6
Revises: c4f8a2b1d9e0
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa

revision = 'f3a1b2c4d5e6'
down_revision = 'c4f8a2b1d9e0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('jobs', sa.Column('runpod_job_id', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('jobs', 'runpod_job_id')
