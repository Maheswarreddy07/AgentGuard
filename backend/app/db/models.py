from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

def _now(): return datetime.now(timezone.utc)
def _ws(): return mapped_column(ForeignKey("workspaces.id"), index=True)

class WorkspaceRow(Base):
    __tablename__ = "workspaces"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class AgentRow(Base):
    __tablename__ = "agents"
    __table_args__ = (UniqueConstraint("workspace_id", "name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = _ws()
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(String(500), default="")
    environment: Mapped[str] = mapped_column(String(32), default="production")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class TraceRow(Base):
    """One agent run. Primary key is (workspace_id, trace_id): two workspaces may reuse an id without ever touching each other's data."""
    __tablename__ = "traces"
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    agent_name: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    n_events: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="clean", index=True)  # clean | flagged
    max_severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    categories: Mapped[list] = mapped_column(JSON, default=list)
    headline: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category_severity: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # run-level facts derived from events
    task: Mapped[str | None] = mapped_column(String(500), nullable=True)
    environment: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(16), nullable=True)           # observe | warn | enforce
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)  # running | succeeded | failed | blocked
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    finding_count: Mapped[int] = mapped_column(Integer, default=0)
    recovery_attempts: Mapped[int] = mapped_column(Integer, default=0)
    blocked_actions: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list["EventRow"]] = relationship(back_populates="trace", cascade="all, delete-orphan")

class EventRow(Base):
    __tablename__ = "events"
    __table_args__ = (ForeignKeyConstraint(["workspace_id", "trace_id"], ["traces.workspace_id", "traces.trace_id"]),
                      UniqueConstraint("workspace_id", "trace_id", "event_id"), Index("ix_events_trace", "workspace_id", "trace_id"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(String(128))
    event_id: Mapped[str] = mapped_column(String(128))
    step_index: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)
    trace: Mapped[TraceRow] = relationship(back_populates="events")

class FindingRow(Base):
    """Persisted detector output. Stable id (hash of trace+rule+evidence) so re-analysis updates rather than duplicates."""
    __tablename__ = "findings"
    __table_args__ = (Index("ix_findings_trace", "workspace_id", "trace_id"), Index("ix_findings_sev", "workspace_id", "severity"))
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    workspace_id: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(String(128))
    event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category: Mapped[str] = mapped_column(String(48), index=True)
    severity: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(12), default="rule")  # rule | heuristic | model
    rule: Mapped[str] = mapped_column(String(48))
    description: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    suggested_action: Mapped[str] = mapped_column(String(64), default="")
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class RiskPredictionRow(Base):
    __tablename__ = "risk_predictions"
    __table_args__ = (Index("ix_risk_trace", "workspace_id", "trace_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(String(128))
    step_index: Mapped[int] = mapped_column(Integer)
    score: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String(12))
    predicted_failure: Mapped[str] = mapped_column(String(48))
    confidence: Mapped[str] = mapped_column(String(8))
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    signals: Mapped[list] = mapped_column(JSON, default=list)
    recommended_action: Mapped[str] = mapped_column(String(48))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    outcome: Mapped[str] = mapped_column(String(16), default="pending")      # pending | occurred | not_occurred
    outcome_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lead_steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class PolicyRow(Base):
    __tablename__ = "policies"
    __table_args__ = (UniqueConstraint("workspace_id", "name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = _ws()
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(500), default="")
    category: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(254), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class PolicyVersionRow(Base):
    __tablename__ = "policy_versions"
    __table_args__ = (UniqueConstraint("policy_id", "version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("policies.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[str] = mapped_column(String(254), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class PolicyEvalRow(Base):
    """Every policy decision, with the exact inputs it saw, so it can be reproduced and audited."""
    __tablename__ = "policy_evaluations"
    __table_args__ = (Index("ix_polev_trace", "workspace_id", "trace_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(String(128))
    step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    policy_id: Mapped[int] = mapped_column(Integer, index=True)
    policy_name: Mapped[str] = mapped_column(String(80))
    version: Mapped[int] = mapped_column(Integer)
    tool_name: Mapped[str] = mapped_column(String(128))
    matched: Mapped[bool] = mapped_column(Boolean)
    action: Mapped[str] = mapped_column(String(20))
    effective: Mapped[str] = mapped_column(String(20))
    mode: Mapped[str] = mapped_column(String(10))
    explanation: Mapped[str] = mapped_column(Text)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

class ApprovalRow(Base):
    __tablename__ = "approval_requests"
    __table_args__ = (Index("ix_appr_ws_status", "workspace_id", "status"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(String(128))
    agent_name: Mapped[str] = mapped_column(String(128), default="")
    tool_name: Mapped[str] = mapped_column(String(128))
    arguments: Mapped[dict] = mapped_column(JSON, default=dict)
    args_hash: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(Text)
    policy_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    evidence_steps: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected | changes_requested | expired
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)       # an approval authorises exactly one execution
    decided_by: Mapped[str | None] = mapped_column(String(254), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class RecoveryRow(Base):
    __tablename__ = "recovery_attempts"
    __table_args__ = (Index("ix_rec_trace", "workspace_id", "trace_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(String(128))
    finding_category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    strategy: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(Text)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    permitted: Mapped[bool] = mapped_column(Boolean, default=True)
    approval_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="proposed")  # proposed | awaiting_approval | executed | verified | failed | blocked | simulated
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    verification: Mapped[list] = mapped_column(JSON, default=list)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(254), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class BenchmarkRow(Base):
    __tablename__ = "benchmark_runs"
    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)  # running | completed | failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)

class UserRow(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(16), default="viewer")  # viewer | member | admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(200), nullable=True)

class ApiKeyRow(Base):
    __tablename__ = "api_keys"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(String(254))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class AuditRow(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # activity | security
    actor: Mapped[str] = mapped_column(String(254))
    actor_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action: Mapped[str] = mapped_column(String(40), index=True)
    target: Mapped[str | None] = mapped_column(String(200), nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)

class SettingRow(Base):
    __tablename__ = "app_settings"
    workspace_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_by: Mapped[str | None] = mapped_column(String(254), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
