"""origin on runs and agents: demo, sample and starter runs are kept apart from production activity"""
from alembic import op
from app.db.upgrade import add_missing_columns, backfill_origin

revision, down_revision = "0005", "0004"

def upgrade():
    bind = op.get_bind()
    add_missing_columns(bind)     # adds the nullable origin columns when they are missing (fresh installs already have them)
    backfill_origin(bind)

def downgrade():
    raise NotImplementedError("Restore a backup instead of downgrading.")
