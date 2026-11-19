"""Deleting things safely: a run takes everything that hangs off it with it, so no orphaned rows are left behind."""
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from app.db.models import AgentRow, ApprovalRow, FindingRow, PolicyEvalRow, RecoveryRow, RiskPredictionRow, TraceRow

CHUNK = 400
DEPENDENTS = (FindingRow, RiskPredictionRow, PolicyEvalRow, ApprovalRow, RecoveryRow)

def delete_traces(db: Session, ws: int, trace_ids) -> int:
    """Remove runs and every row that belongs to them (events, findings, risk predictions, rule decisions, approvals, recoveries). Does not commit."""
    ids, n = list(dict.fromkeys(trace_ids)), 0
    for i in range(0, len(ids), CHUNK):
        part = ids[i:i + CHUNK]
        for model in DEPENDENTS:
            db.execute(delete(model).where(model.workspace_id == ws, model.trace_id.in_(part)))
        for t in db.scalars(select(TraceRow).where(TraceRow.workspace_id == ws, TraceRow.trace_id.in_(part))).all():
            db.delete(t); n += 1       # events go with it (cascade)
    db.flush()
    return n

def run_count(db: Session, ws: int, agent: str) -> int:
    return db.scalar(select(func.count()).select_from(TraceRow).where(TraceRow.workspace_id == ws, TraceRow.agent_name == agent)) or 0

def delete_agent(db: Session, ws: int, name: str, with_runs: bool) -> tuple[bool, int]:
    """Returns (found, runs_deleted). Refuses to drop an agent that still has runs unless `with_runs`."""
    row = db.scalar(select(AgentRow).where(AgentRow.workspace_id == ws, AgentRow.name == name))
    if row is None: return False, 0
    ids = list(db.scalars(select(TraceRow.trace_id).where(TraceRow.workspace_id == ws, TraceRow.agent_name == name)))
    if ids and not with_runs: raise ValueError(f"{len(ids)} runs")
    n = delete_traces(db, ws, ids); db.delete(row); db.flush()
    return True, n

def delete_synthetic(db: Session, ws: int) -> tuple[int, int]:
    """Remove everything that is not real activity: demo data, sample runs and the starter file's test run, plus agents that only exist because of them."""
    from app.services.scope import SYNTHETIC
    ids = list(db.scalars(select(TraceRow.trace_id).where(TraceRow.workspace_id == ws, TraceRow.origin.in_(SYNTHETIC))))
    runs = delete_traces(db, ws, ids); agents = 0
    for a in db.scalars(select(AgentRow).where(AgentRow.workspace_id == ws, AgentRow.origin.in_(SYNTHETIC))).all():
        if run_count(db, ws, a.name) == 0: db.delete(a); agents += 1
    db.flush()
    return runs, agents
