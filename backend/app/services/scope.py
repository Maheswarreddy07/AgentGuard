"""Which runs count as real activity. Production numbers never include demo data, sample runs or the starter file's test run."""
from typing import Literal
from sqlalchemy import or_, select
from app.db.models import TraceRow

Scope = Literal["production", "synthetic", "all"]
SYNTHETIC = ("demo", "sample", "starter")

def origin_of(events, explicit: str | None = None) -> str:
    """Where a run came from. Marked by whoever created it (demo loader, sample runner) or by a flag the starter file puts on its events."""
    if explicit: return explicit
    for e in events:
        md = e.metadata or {}
        if md.get("starter"): return "starter"
        if md.get("sample_run"): return "sample"
        if md.get("synthetic") or md.get("demo"): return "demo"
    return "production"

def trace_cond(scope: str):
    """SQL condition on TraceRow for a scope (None = no filter). Old rows with no origin count as production."""
    if scope == "all": return None
    if scope == "synthetic": return TraceRow.origin.in_(SYNTHETIC)
    return or_(TraceRow.origin == "production", TraceRow.origin.is_(None))

def trace_ids(ws: int, scope: str):
    """A subquery of trace ids in scope, for filtering findings, approvals, predictions."""
    q = select(TraceRow.trace_id).where(TraceRow.workspace_id == ws); c = trace_cond(scope)
    return q if c is None else q.where(c)

def scoped(q, scope: str):
    """Apply the scope to a `select(TraceRow)` query."""
    c = trace_cond(scope)
    return q if c is None else q.where(c)

def by_trace(col, ws: int, scope: str):
    """Condition for rows that point at a run (findings, approvals, predictions). Production excludes anything tied to a synthetic run."""
    if scope == "all": return None
    syn = select(TraceRow.trace_id).where(TraceRow.workspace_id == ws, TraceRow.origin.in_(SYNTHETIC))
    return col.in_(syn) if scope == "synthetic" else ~col.in_(syn)

_INTEGRATION_RANK = {"sample": 1, "starter_file": 2, "api": 3, "sdk": 4}

def integration_of(events, origin: str) -> str:
    """How a run reached AgentGuard: the Python SDK marks its runs, the starter file and sample runner are marked by origin, anything else is a direct API call."""
    if origin == "starter": return "starter_file"
    if origin in ("sample", "demo"): return "sample"
    return "sdk" if any((e.metadata or {}).get("sdk") for e in events) else "api"

def stronger_integration(current: str | None, new: str) -> str:
    return new if current is None or _INTEGRATION_RANK.get(new, 0) > _INTEGRATION_RANK.get(current, 0) else current
