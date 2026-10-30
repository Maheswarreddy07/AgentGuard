"""users, sessions, api keys, audit log, settings, category severity"""
import sqlalchemy as sa
from alembic import op

revision, down_revision = "0003", "0002"

def upgrade():
    op.add_column("traces", sa.Column("category_severity", sa.JSON))
    op.create_table("users", sa.Column("id", sa.Integer, primary_key=True, autoincrement=True), sa.Column("email", sa.String(254), nullable=False), sa.Column("name", sa.String(120), nullable=False),
                    sa.Column("password_hash", sa.String(300), nullable=False), sa.Column("role", sa.String(16), nullable=False), sa.Column("is_active", sa.Boolean, nullable=False),
                    sa.Column("failed_attempts", sa.Integer, nullable=False), sa.Column("locked_until", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("last_login_at", sa.DateTime(timezone=True)))
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table("sessions", sa.Column("id", sa.Integer, primary_key=True, autoincrement=True), sa.Column("token_hash", sa.String(64), nullable=False),
                    sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False), sa.Column("revoked", sa.Boolean, nullable=False), sa.Column("ip", sa.String(64)), sa.Column("user_agent", sa.String(200)))
    op.create_index("ix_sessions_token_hash", "sessions", ["token_hash"], unique=True); op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table("api_keys", sa.Column("id", sa.Integer, primary_key=True, autoincrement=True), sa.Column("name", sa.String(80), nullable=False), sa.Column("prefix", sa.String(16), nullable=False),
                    sa.Column("key_hash", sa.String(64), nullable=False), sa.Column("created_by", sa.String(254), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("last_used_at", sa.DateTime(timezone=True)), sa.Column("revoked_at", sa.DateTime(timezone=True)))
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)
    op.create_table("audit_log", sa.Column("id", sa.Integer, primary_key=True, autoincrement=True), sa.Column("ts", sa.DateTime(timezone=True), nullable=False), sa.Column("kind", sa.String(16), nullable=False),
                    sa.Column("actor", sa.String(254), nullable=False), sa.Column("actor_role", sa.String(16)), sa.Column("action", sa.String(40), nullable=False), sa.Column("target", sa.String(200)), sa.Column("detail", sa.JSON, nullable=False))
    op.create_index("ix_audit_log_ts", "audit_log", ["ts"]); op.create_index("ix_audit_log_kind", "audit_log", ["kind"]); op.create_index("ix_audit_log_action", "audit_log", ["action"])
    op.create_table("app_settings", sa.Column("key", sa.String(64), primary_key=True), sa.Column("value", sa.JSON, nullable=False), sa.Column("updated_by", sa.String(254)), sa.Column("updated_at", sa.DateTime(timezone=True)))

def downgrade():
    for t in ("app_settings", "audit_log", "api_keys", "sessions", "users"): op.drop_table(t)
    op.drop_column("traces", "category_severity")
