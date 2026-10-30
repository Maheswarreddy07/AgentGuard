from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import EventRow, TraceRow
from app.redaction import redact
from app.catalog import SEV_RANK
from app.detectors.rules import run_all
from app.schemas.events import Event

def ingest(db: Session, trace_id: str, events: list[Event]) -> dict:
    """Idempotent: duplicate (trace_id,event_id) are skipped. Out-of-order arrival is fine; reads sort by step."""
    accepted = dup = 0
    for e in events:
        if e.trace_id != trace_id:
            raise ValueError(f"event {e.event_id} has trace_id {e.trace_id!r}, expected {trace_id!r}")
    trace = db.get(TraceRow, trace_id)
    if trace is None and events:
        trace = TraceRow(trace_id=trace_id, agent_name=events[0].agent_name)
        db.add(trace)
    existing = set(db.scalars(select(EventRow.event_id).where(EventRow.trace_id == trace_id)))
    for e in events:
        if e.event_id in existing:
            dup += 1
            continue
        d = e.model_dump(mode="json")
        d["tool_input"], d["tool_output"] = redact(d["tool_input"]), redact(d["tool_output"])
        d["metadata"] = redact(d["metadata"])
        db.add(EventRow(trace_id=trace_id, event_id=e.event_id, step_index=e.step_index, payload=d))
        existing.add(e.event_id)
        accepted += 1
    db.flush()
    if events:
        refresh_summary(db, trace_id)
    db.commit()
    return {"accepted": accepted, "duplicates": dup}

def load_events(db: Session, trace_id: str) -> list[Event]:
    rows = db.scalars(select(EventRow).where(EventRow.trace_id == trace_id).order_by(EventRow.step_index, EventRow.id))
    return [Event.model_validate(r.payload) for r in rows]


def refresh_summary(db: Session, trace_id: str) -> None:
    """Cache detector results on the trace row so lists/filters/overview don't re-run detectors."""
    t = db.get(TraceRow, trace_id)
    evs = load_events(db, trace_id)
    fs = run_all(evs)
    top = max(fs, key=lambda f: SEV_RANK[f.severity.value], default=None)
    t.n_events, t.status = len(evs), ("flagged" if fs else "clean")
    t.max_severity = top.severity.value if top else None
    t.categories = sorted({f.category.value for f in fs})
    t.headline = top.explanation[:500] if top else None
    t.updated_at = datetime.now(timezone.utc)

def backfill_summaries(db: Session) -> int:
    ids = list(db.scalars(select(TraceRow.trace_id).where((TraceRow.updated_at.is_(None)) | (TraceRow.status.is_(None)))))
    for i in ids:
        refresh_summary(db, i)
    db.commit()
    return len(ids)
