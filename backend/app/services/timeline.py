"""A readable timeline of what agents did, built from stored runs, findings, rule decisions, approvals and recovery events. Nothing is invented."""
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import ApprovalRow, EventRow, FindingRow, PolicyEvalRow, TraceRow
from app.services.scope import scoped

def _ts(x) -> datetime:
    if isinstance(x, str): x = datetime.fromisoformat(x.replace("Z", "+00:00"))
    if x is None: return datetime.fromtimestamp(0, timezone.utc)
    return x if x.tzinfo else x.replace(tzinfo=timezone.utc)

def build(db: Session, ws: int, scope: str, runs: int, offset: int) -> dict:
    traces = list(db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == ws), scope).order_by(TraceRow.created_at.desc()).offset(offset).limit(runs)))
    ids = [t.trace_id for t in traces] or [""]; by_trace = {t.trace_id: t for t in traces}
    out: list[dict] = []
    def add(t, kind, when, **kw): out.append({"kind": kind, "ts": _ts(when).isoformat(), "trace_id": t.trace_id, "agent": t.agent_name, **kw})
    for t in traces:
        add(t, "task_started", t.started_at or t.created_at, task=t.task or t.headline)
        if t.outcome in ("succeeded", "failed") and t.finished_at: add(t, "task_completed" if t.outcome == "succeeded" else "task_failed", t.finished_at, task=t.task or t.headline)
    for f in db.scalars(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.trace_id.in_(ids))):
        add(by_trace[f.trace_id], "problem_detected", f.detected_at, severity=f.severity, category=f.category, finding_id=f.id, resolved=bool(f.resolved_at))
    for e in db.scalars(select(PolicyEvalRow).where(PolicyEvalRow.workspace_id == ws, PolicyEvalRow.trace_id.in_(ids), PolicyEvalRow.matched == True)):   # noqa: E712
        if e.effective in ("BLOCK", "REQUIRE_APPROVAL"): add(by_trace[e.trace_id], "action_blocked" if e.effective == "BLOCK" else "approval_requested", e.created_at, tool=e.tool_name, rule=e.policy_name)
    for a in db.scalars(select(ApprovalRow).where(ApprovalRow.workspace_id == ws, ApprovalRow.trace_id.in_(ids), ApprovalRow.decided_at.is_not(None))):
        if a.trace_id in by_trace: add(by_trace[a.trace_id], "approval_decided", a.decided_at, tool=a.tool_name, status=a.status, by=a.decided_by)
    for ev in db.scalars(select(EventRow).where(EventRow.workspace_id == ws, EventRow.trace_id.in_(ids))):
        kind = (ev.payload or {}).get("event_type")
        if kind in ("recovery_attempt", "recovery_completed"): add(by_trace[ev.trace_id], "recovery_attempted" if kind == "recovery_attempt" else "recovery_completed", (ev.payload or {}).get("timestamp"), tool=(ev.payload or {}).get("tool_name"), ok=(ev.payload or {}).get("status") != "error")
    out.sort(key=lambda x: x["ts"], reverse=True)
    return {"items": out, "runs": len(traces), "offset": offset, "next_offset": offset + len(traces) if len(traces) == runs else None}
