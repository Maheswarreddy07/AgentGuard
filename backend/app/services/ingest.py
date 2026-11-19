import hashlib
from datetime import datetime, timezone
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.catalog import SEV_RANK
from app.services.scope import integration_of, origin_of, stronger_integration
from app.db.models import AgentRow, EventRow, FindingRow, RiskPredictionRow, TraceRow
from app.detectors.rules import run_all
from app.detectors.scanners import annotate_event
from app.redaction import redact
from app.risk.engine import predict_run, resolve_outcomes
from app.schemas.events import Event, EventType
from app.services.settings import load_config

def get_trace(db: Session, ws: int, trace_id: str) -> TraceRow | None:
    return db.get(TraceRow, (ws, trace_id))

def ingest(db: Session, ws: int, trace_id: str, events: list[Event], origin: str | None = None) -> dict:
    """Idempotent per (workspace, trace, event). Out-of-order arrival is fine; reads sort by step."""
    for e in events:
        if e.trace_id != trace_id:
            raise ValueError(f"event {e.event_id} has trace_id {e.trace_id!r}, expected {trace_id!r}")
    trace = get_trace(db, ws, trace_id)
    if trace is None and events:
        trace = TraceRow(workspace_id=ws, trace_id=trace_id, agent_name=events[0].agent_name, origin=origin_of(events, origin)); db.add(trace)
    if events:
        ag = db.scalar(select(AgentRow).where(AgentRow.workspace_id == ws, AgentRow.name == events[0].agent_name))
        if ag is None: ag = AgentRow(workspace_id=ws, name=events[0].agent_name, origin=(trace.origin if trace else "production")); db.add(ag)
        elif trace is not None and (trace.origin or "production") == "production": ag.origin = "production"      # a real run makes it a real agent
        ag.last_seen_at = datetime.now(timezone.utc)
        ag.integration = stronger_integration(ag.integration, integration_of(events, trace.origin if trace else "production"))
    existing = set(db.scalars(select(EventRow.event_id).where(EventRow.workspace_id == ws, EventRow.trace_id == trace_id)))
    accepted = dup = 0
    for e in events:
        if e.event_id in existing:
            dup += 1; continue
        d = annotate_event(e).model_dump(mode="json")      # scan RAW content first, then redact what gets stored
        d["tool_input"], d["tool_output"], d["metadata"] = redact(d["tool_input"]), redact(d["tool_output"]), redact(d["metadata"])
        db.add(EventRow(workspace_id=ws, trace_id=trace_id, event_id=e.event_id, step_index=e.step_index, payload=d)); existing.add(e.event_id); accepted += 1
    db.flush()
    if events: refresh_summary(db, ws, trace_id)
    db.commit()
    return {"accepted": accepted, "duplicates": dup}

def load_events(db: Session, ws: int, trace_id: str) -> list[Event]:
    rows = db.scalars(select(EventRow).where(EventRow.workspace_id == ws, EventRow.trace_id == trace_id).order_by(EventRow.step_index, EventRow.id))
    return [Event.model_validate(r.payload) for r in rows]

def finding_id(ws: int, trace_id: str, f) -> str:
    return hashlib.sha1(f"{ws}|{trace_id}|{f.rule}|{f.category.value}|{','.join(f.evidence_event_ids)}".encode()).hexdigest()[:24]

def refresh_summary(db: Session, ws: int, trace_id: str) -> None:
    """Recompute detector findings, risk predictions and run-level facts, and cache them on the trace row."""
    t = get_trace(db, ws, trace_id); evs = sorted(load_events(db, ws, trace_id), key=lambda e: e.step_index); cfg = load_config(db, ws)
    fs = run_all(evs, cfg.disabled_rules, cfg.retry_loop_threshold, cfg.duplicate_call_threshold)
    step_of = {e.event_id: e.step_index for e in evs}
    kept = {r.id: (r.resolved_at, r.resolved_by, r.resolution_note) for r in db.scalars(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.trace_id == trace_id)) if r.resolved_at}   # a problem someone resolved stays resolved
    db.execute(delete(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.trace_id == trace_id))
    for f in fs:
        fid = finding_id(ws, trace_id, f); was = kept.get(fid, (None, None, None))
        db.add(FindingRow(id=fid, resolved_at=was[0], resolved_by=was[1], resolution_note=was[2],
                          workspace_id=ws, trace_id=trace_id, event_id=f.detectable_event_id or (f.evidence_event_ids[0] if f.evidence_event_ids else None),
                          category=f.category.value, severity=f.severity.value, confidence=f.confidence, source="rule" if f.deterministic else "heuristic", rule=f.rule,
                          description=f.explanation, evidence=f.evidence, suggested_action=f.recommended_action))
    start = next((e for e in evs if e.event_type == EventType.RUN_START), None); end = next((e for e in evs if e.event_type == EventType.RUN_END), None)
    peak, alerts = predict_run(evs, cfg)
    alerts = resolve_outcomes(alerts, fs, step_of, finished=end is not None)
    db.execute(delete(RiskPredictionRow).where(RiskPredictionRow.workspace_id == ws, RiskPredictionRow.trace_id == trace_id))
    for a in alerts:
        db.add(RiskPredictionRow(workspace_id=ws, trace_id=trace_id, step_index=a["step_index"], score=a["score"], level=a["level"], predicted_failure=a["predicted_failure"], confidence=a["confidence"],
                                 evidence=a["evidence"], signals=a["signals"], recommended_action=a["recommended_action"], outcome=a["outcome"], outcome_step=a["outcome_step"], lead_steps=a["lead_steps"],
                                 resolved_at=datetime.now(timezone.utc) if a["outcome"] != "pending" else None))
    top = max(fs, key=lambda f: SEV_RANK[f.severity.value], default=None); md = (start.metadata if start else {}) or {}
    t.n_events, t.status = len(evs), ("flagged" if fs else "clean")
    t.max_severity = top.severity.value if top else None
    t.categories = sorted({f.category.value for f in fs}); t.finding_count = len(fs)
    cs: dict = {}
    for f in fs:
        if SEV_RANK[f.severity.value] > SEV_RANK.get(cs.get(f.category.value, ""), 0): cs[f.category.value] = f.severity.value
    t.category_severity = cs
    t.headline = top.explanation[:500] if top else None
    t.task = (md.get("task") or None) and str(md["task"])[:500]; t.environment = md.get("environment"); t.mode = md.get("mode")
    t.started_at = evs[0].timestamp if evs else None; t.finished_at = end.timestamp if end else None
    t.duration_ms = int((end.timestamp - evs[0].timestamp).total_seconds() * 1000) if end and evs else None
    t.tool_calls = sum(e.event_type == EventType.TOOL_CALL for e in evs)
    t.tokens_in, t.tokens_out, t.cost_usd = sum(e.tokens_in or 0 for e in evs), sum(e.tokens_out or 0 for e in evs), round(sum(e.cost_usd or 0 for e in evs), 6)
    t.risk_score = peak
    t.recovery_attempts = sum(e.event_type in (EventType.RECOVERY_ATTEMPT, EventType.RECOVERY_COMPLETED) for e in evs)
    t.blocked_actions = sum(e.event_type == EventType.POLICY_CHECK and e.metadata.get("effective") == "BLOCK" for e in evs)
    if end is None: t.outcome = "running"
    elif t.blocked_actions and end.metadata.get("claimed_success") is not True: t.outcome = "blocked"
    elif end.metadata.get("claimed_success") is False or t.max_severity in ("high", "critical"): t.outcome = "failed"
    else: t.outcome = "succeeded"
    t.updated_at = datetime.now(timezone.utc)

def backfill_summaries(db: Session) -> int:
    rows = list(db.execute(select(TraceRow.workspace_id, TraceRow.trace_id).where((TraceRow.updated_at.is_(None)) | (TraceRow.outcome.is_(None)) | (TraceRow.category_severity.is_(None)))))
    for ws, tid in rows: refresh_summary(db, ws, tid)
    db.commit()
    return len(rows)

def refresh_all(db: Session, ws: int) -> int:
    ids = list(db.scalars(select(TraceRow.trace_id).where(TraceRow.workspace_id == ws)))
    for i in ids: refresh_summary(db, ws, i)
    db.commit()
    return len(ids)


def aware_ok(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
