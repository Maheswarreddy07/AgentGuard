"""Problems, explained: what happened, why it matters, which agent, what AgentGuard did and what to do next. Everything comes from stored findings, rule decisions and runs."""
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.catalog import ACTIONS, CATEGORIES
from app.db.models import FindingRow, PolicyEvalRow, TraceRow
from app.services.scope import by_trace

GROUPS = ("critical", "warning", "resolved")
SERIOUS = ("critical", "high")

def group_of(f: FindingRow) -> str:
    return "resolved" if f.resolved_at else "critical" if f.severity in SERIOUS else "warning"

def confirmed(f: FindingRow) -> bool:
    """A rule verified the condition (confidence 1.0) = a confirmed violation. Anything lower is a documented heuristic = a possible risk."""
    return f.confidence is None or f.confidence >= 1.0

def what_agentguard_did(trace: TraceRow | None, evals: list[PolicyEvalRow]) -> dict:
    hit = [e for e in evals if e.matched]
    for key, effective in (("blocked", "BLOCK"), ("approval", "REQUIRE_APPROVAL")):
        m = next((e for e in hit if e.effective == effective), None)
        if m: return {"key": key, "tool": m.tool_name, "rule": m.policy_name}
    if trace is not None and trace.recovery_attempts: return {"key": "recovery", "tool": None, "rule": None}
    m = next((e for e in hit if e.effective == "WARN"), None)
    if m: return {"key": "warned", "tool": m.tool_name, "rule": m.policy_name}
    return {"key": "recorded", "tool": None, "rule": None}

def problem_item(f: FindingRow, trace: TraceRow | None, evals: list[PolicyEvalRow]) -> dict:
    cat = CATEGORIES.get(f.category, {}); act = ACTIONS.get(f.suggested_action, {})
    steps = [x for x in (cat.get("fix"), act.get("plain")) if x]
    return {"id": f.id, "trace_id": f.trace_id, "agent": trace.agent_name if trace else None, "severity": f.severity, "group": group_of(f), "category": f.category, "confirmed": confirmed(f), "rule": f.rule, "event_id": f.event_id,
            "detected_at": f.detected_at, "resolved_at": f.resolved_at, "resolved_by": f.resolved_by, "resolution_note": f.resolution_note,
            "what_happened": cat.get("plain") or f.description, "technical_description": f.description, "title": cat.get("title"), "why_it_matters": cat.get("why"), "what_agentguard_did": what_agentguard_did(trace, evals), "next_steps": steps, "evidence": f.evidence}

def _incident_key(f: FindingRow) -> tuple:
    return (f.trace_id, f.category, f.rule)

def _collapse(rows: list[FindingRow]) -> tuple[list[FindingRow], dict[str, int]]:
    """One row per (run, kind of problem). The representative is an unresolved member if there is one, else the most serious, then the earliest step."""
    groups: dict[tuple, list[FindingRow]] = {}
    for r in rows: groups.setdefault(_incident_key(r), []).append(r)
    rep, size = [], {}
    for g in groups.values():
        best = sorted(g, key=lambda r: (r.resolved_at is not None, SERIOUS.index(r.severity) if r.severity in SERIOUS else 9, r.event_id or ""))[0]
        rep.append(best); size[best.id] = len(g)
    return rep, size

def _siblings(db: Session, ws: int, f: FindingRow) -> list[FindingRow]:
    return [x for x in db.scalars(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.trace_id == f.trace_id, FindingRow.category == f.category)) if x.rule == f.rule]

def list_problems(db: Session, ws: int, scope: str, group: str | None, agent: str | None, limit: int, offset: int) -> dict:
    q = select(FindingRow).where(FindingRow.workspace_id == ws); sc = by_trace(FindingRow.trace_id, ws, scope)
    if sc is not None: q = q.where(sc)
    rows = list(db.scalars(q)); traces = {t.trace_id: t for t in db.scalars(select(TraceRow).where(TraceRow.workspace_id == ws, TraceRow.trace_id.in_({r.trace_id for r in rows} or {""})))}
    if agent: rows = [r for r in rows if traces.get(r.trace_id) and traces[r.trace_id].agent_name == agent]
    rows, size = _collapse(rows)            # the same kind of problem repeated within one run is one incident, shown once with a count
    counts = {g: sum(group_of(r) == g for r in rows) for g in GROUPS}
    if group: rows = [r for r in rows if group_of(r) == group]
    rows.sort(key=lambda r: (SERIOUS.index(r.severity) if r.severity in SERIOUS else 9, -(r.detected_at.timestamp() if r.detected_at else 0)))
    page = rows[offset:offset + limit]
    evals: dict[str, list[PolicyEvalRow]] = {}
    for e in db.scalars(select(PolicyEvalRow).where(PolicyEvalRow.workspace_id == ws, PolicyEvalRow.trace_id.in_({r.trace_id for r in page} or {""}))): evals.setdefault(e.trace_id, []).append(e)
    return {"counts": counts, "total": len(rows), "items": [{**problem_item(r, traces.get(r.trace_id), evals.get(r.trace_id, [])), "occurrences": size[r.id]} for r in page]}

def resolve(db: Session, ws: int, fid: str, by: str, note: str | None) -> FindingRow | None:
    f = db.scalar(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.id == fid))
    if f is not None:
        now = datetime.now(timezone.utc)
        for x in _siblings(db, ws, f): x.resolved_at, x.resolved_by, x.resolution_note = now, by, (note or None)
    return f

def reopen(db: Session, ws: int, fid: str) -> FindingRow | None:
    f = db.scalar(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.id == fid))
    if f is not None:
        for x in _siblings(db, ws, f): x.resolved_at = x.resolved_by = x.resolution_note = None
    return f
