"""initial schema"""
import sqlalchemy as sa
from alembic import op

revision, down_revision = "0001", None

def upgrade():
    op.create_table("traces", sa.Column("trace_id", sa.String(128), primary_key=True), sa.Column("agent_name", sa.String(128), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_traces_agent_name", "traces", ["agent_name"])
    op.create_table("events", sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
                    sa.Column("trace_id", sa.String(128), sa.ForeignKey("traces.trace_id"), nullable=False),
                    sa.Column("event_id", sa.String(128), nullable=False), sa.Column("step_index", sa.Integer, nullable=False),
                    sa.Column("payload", sa.JSON, nullable=False), sa.UniqueConstraint("trace_id", "event_id"))
    op.create_index("ix_events_trace_id", "events", ["trace_id"])
    op.create_table("benchmark_runs", sa.Column("run_id", sa.String(64), primary_key=True), sa.Column("status", sa.String(16), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("finished_at", sa.DateTime(timezone=True)),
                    sa.Column("params", sa.JSON, nullable=False), sa.Column("result", sa.JSON), sa.Column("error", sa.String(500)))
    op.create_index("ix_benchmark_runs_status", "benchmark_runs", ["status"])

def downgrade():
    op.drop_table("benchmark_runs"); op.drop_table("events"); op.drop_table("traces")
