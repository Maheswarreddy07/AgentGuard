"""cache detector summary on traces"""
import sqlalchemy as sa
from alembic import op

revision, down_revision = "0002", "0001"

def upgrade():
    op.add_column("traces", sa.Column("n_events", sa.Integer))
    op.add_column("traces", sa.Column("status", sa.String(16)))
    op.add_column("traces", sa.Column("max_severity", sa.String(16)))
    op.add_column("traces", sa.Column("categories", sa.JSON))
    op.add_column("traces", sa.Column("headline", sa.String(500)))
    op.add_column("traces", sa.Column("updated_at", sa.DateTime(timezone=True)))
    op.create_index("ix_traces_status", "traces", ["status"])

def downgrade():
    op.drop_index("ix_traces_status", "traces")
    for c in ("updated_at", "headline", "categories", "max_severity", "status", "n_events"):
        op.drop_column("traces", c)
