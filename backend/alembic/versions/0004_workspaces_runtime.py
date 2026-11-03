"""workspaces, agents, findings, risk predictions, policies, approvals, recovery; traces keyed by (workspace_id, trace_id)

Uses the same data-preserving helpers as the dev auto-upgrade. NOTE: because this revision builds tables from the models,
any later revision that changes these tables must first check whether the column already exists (fresh installs get the final shape here)."""
from alembic import op
from app.db.models import Base
from app.db.upgrade import add_missing_columns, backfill_workspace_ids, upgrade_to_workspaces

revision, down_revision = "0004", "0003"

def upgrade():
    bind = op.get_bind()
    upgrade_to_workspaces(bind)       # rebuild traces/events/app_settings with the new keys, keeping rows
    Base.metadata.create_all(bind)    # create tables that do not exist yet (checkfirst)
    add_missing_columns(bind)         # new nullable columns on existing tables (users, api_keys, audit_log, benchmark_runs)
    backfill_workspace_ids(bind)

def downgrade():
    raise NotImplementedError("Downgrading across the workspace change is not supported; restore a backup instead.")
