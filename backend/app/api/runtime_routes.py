import json, os, uuid
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.deps import Principal, audit, get_db, needs, require, require_agent
from app.auth import sha
from app.services import problems as P, timeline as TL
from app.services.scope import Scope, SYNTHETIC, by_trace, scoped
from app.services.starter import starter_file
from app.catalog import ACTIONS, AGENT_QUIET_DAYS, CATEGORIES as FAIL_CATS, SEV_RANK
from app.db.models import AgentRow, ApprovalRow, FindingRow, PolicyEvalRow, PolicyRow, PolicyVersionRow, RiskPredictionRow, TraceRow
from app.redaction import redact
from app.risk.engine import ACTION_FOR, assess
from app.runtime import policy_engine as PE
from app.schemas.events import Event, EventType, Status
from app.services.ingest import aware_ok, get_trace, ingest, load_events
from app.services.settings import load_config

router = APIRouter(prefix="/api/v1", tags=["runtime"])
Mode = Literal["observe", "warn", "enforce"]
def _now(): return datetime.now(timezone.utc)
def _canon(a): return json.dumps(a or {}, sort_keys=True, default=str)

# ======================= policies =======================
class PolicyIn(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9_. -]+$"); description: str = Field(default="", max_length=500)
    category: Literal[tuple(PE.CATEGORIES)] = "custom"; definition: dict; enabled: bool = True; note: str = Field(default="", max_length=300)
class PolicyUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=500); category: Literal[tuple(PE.CATEGORIES)] | None = None; definition: dict | None = None; note: str = Field(default="", max_length=300)

def _validate(defn: dict) -> PE.PolicyDef:
    try: return PE.PolicyDef.model_validate(defn)
    except ValidationError as e:
        raise HTTPException(422, "Invalid policy: " + "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:5]))

def _versions(db: Session, pid: int): return list(db.scalars(select(PolicyVersionRow).where(PolicyVersionRow.policy_id == pid).order_by(PolicyVersionRow.version.desc())))
def _policy(db: Session, ws: int, pid: int) -> PolicyRow:
    p = db.get(PolicyRow, pid)
    if not p or p.workspace_id != ws: raise HTTPException(404, "Policy not found.")
    return p
def _pdump(db: Session, p: PolicyRow, with_versions=False) -> dict:
    vs = _versions(db, p.id); cur = next(v for v in vs if v.version == p.current_version)
    out = {"id": p.id, "name": p.name, "description": p.description, "category": p.category, "enabled": p.enabled, "version": p.current_version, "definition": cur.definition, "created_by": p.created_by, "created_at": p.created_at, "n_versions": len(vs)}
    if with_versions: out["versions"] = [{"version": v.version, "note": v.note, "created_by": v.created_by, "created_at": v.created_at, "definition": v.definition} for v in vs]
    return out
def active_policies(db: Session, ws: int):
    out = []
    for p in db.scalars(select(PolicyRow).where(PolicyRow.workspace_id == ws, PolicyRow.enabled.is_(True))):
        v = db.scalar(select(PolicyVersionRow).where(PolicyVersionRow.policy_id == p.id, PolicyVersionRow.version == p.current_version))
        out.append((p.id, p.name, p.current_version, PE.PolicyDef.model_validate(v.definition)))
    return out

@router.get("/policies/templates")
def policy_templates(_: Principal = Depends(require("viewer"))): return {"items": PE.TEMPLATES, "categories": PE.CATEGORIES, "actions": PE.PRECEDENCE, "condition_types": list(PE.CondType.__args__), "condition_specs": PE.CONDITION_SPECS, "operators": list(PE.OPS)}

@router.get("/policies")
def list_policies(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    rows = db.scalars(select(PolicyRow).where(PolicyRow.workspace_id == p.workspace_id).order_by(PolicyRow.name))
    stats = {pid: (n, m) for pid, n, m in db.execute(select(PolicyEvalRow.policy_id, func.count(), func.sum(PolicyEvalRow.matched.cast(__import__("sqlalchemy").Integer))).where(PolicyEvalRow.workspace_id == p.workspace_id).group_by(PolicyEvalRow.policy_id))}
    eff: dict[int, dict] = {}                 # what each rule really did when it matched, counted from the recorded decisions
    for pid, effective, action, n, last in db.execute(select(PolicyEvalRow.policy_id, PolicyEvalRow.effective, PolicyEvalRow.action, func.count(), func.max(PolicyEvalRow.created_at)).where(PolicyEvalRow.workspace_id == p.workspace_id, PolicyEvalRow.matched.is_(True)).group_by(PolicyEvalRow.policy_id, PolicyEvalRow.effective, PolicyEvalRow.action)):
        e = eff.setdefault(pid, {"blocked": 0, "approval_requested": 0, "warned": 0, "only_watched": 0, "last_matched_at": None})
        if effective == "BLOCK": e["blocked"] += n
        elif effective == "REQUIRE_APPROVAL": e["approval_requested"] += n
        elif effective == "WARN": e["warned"] += n
        elif action in ("BLOCK", "REQUIRE_APPROVAL", "WARN"): e["only_watched"] += n      # the rule matched but the mode (observe) let it through
        e["last_matched_at"] = max(filter(None, [e["last_matched_at"], last]), default=None)
    return {"items": [{**_pdump(db, r), "evaluations": stats.get(r.id, (0, 0))[0], "matches": int(stats.get(r.id, (0, 0))[1] or 0), "effects": eff.get(r.id, {"blocked": 0, "approval_requested": 0, "warned": 0, "only_watched": 0, "last_matched_at": None})} for r in rows]}

@router.post("/policies", status_code=201)
def create_policy(b: PolicyIn, p: Principal = Depends(needs("edit_policies")), db: Session = Depends(get_db)):
    _validate(b.definition)
    if db.scalar(select(PolicyRow).where(PolicyRow.workspace_id == p.workspace_id, PolicyRow.name == b.name)): raise HTTPException(409, "A policy with this name already exists.")
    row = PolicyRow(workspace_id=p.workspace_id, name=b.name, description=b.description, category=b.category, enabled=b.enabled, created_by=p.email); db.add(row); db.flush()
    db.add(PolicyVersionRow(policy_id=row.id, version=1, definition=PE.PolicyDef.model_validate(b.definition).model_dump(mode="json"), note=b.note or "Created", created_by=p.email)); db.commit()
    audit(db, p, "policy_created", b.name); return _pdump(db, row, True)

@router.get("/policies/evaluations")
def policy_evaluations(policy_id: int | None = None, trace_id: str | None = None, matched_only: bool = False, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                       p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    q = select(PolicyEvalRow).where(PolicyEvalRow.workspace_id == p.workspace_id)
    if policy_id: q = q.where(PolicyEvalRow.policy_id == policy_id)
    if trace_id: q = q.where(PolicyEvalRow.trace_id == trace_id)
    if matched_only: q = q.where(PolicyEvalRow.matched.is_(True))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(PolicyEvalRow.created_at.desc(), PolicyEvalRow.id.desc()).limit(limit).offset(offset))
    return {"total": total, "items": [{"id": r.id, "trace_id": r.trace_id, "step_index": r.step_index, "policy_id": r.policy_id, "policy_name": r.policy_name, "version": r.version, "tool_name": r.tool_name,
                                       "matched": r.matched, "action": r.action, "effective": r.effective, "mode": r.mode, "explanation": r.explanation, "context": r.context, "created_at": r.created_at} for r in rows]}

class TestIn(BaseModel):
    definition: dict
    context: dict = Field(default_factory=dict)   # agent, tool, args, consequential, actor_role, approval_ok, prior_calls=[{tool,args,ok}]
    mode: Mode = "enforce"

def _history_from(prior: list[dict]) -> list[Event]:
    ev, step, ts = [], 0, datetime(2026, 1, 1, tzinfo=timezone.utc)
    for c in prior[:200]:
        for kind, st in (("tool_call", "ok"), ("tool_result", "ok" if c.get("ok", True) else "error")):
            ev.append(Event(trace_id="t", run_id="t", event_id=f"h{step}", agent_name="a", event_type=kind, timestamp=ts + timedelta(seconds=step), step_index=step, tool_name=c.get("tool"),
                            tool_input=c.get("args") if kind == "tool_call" else None, status=st, tool_output={} if kind == "tool_result" else None)); step += 1
    return ev

@router.post("/policies/test")
def test_policy(b: TestIn, _: Principal = Depends(require("viewer"))):
    d = _validate(b.definition); c = b.context
    ctx = PE.Context(agent=c.get("agent", "agent"), tool=c.get("tool", ""), args=c.get("args") or {}, consequential=bool(c.get("consequential")), actor_role=c.get("actor_role"),
                     history=_history_from(c.get("prior_calls") or []), approval_ok=bool(c.get("approval_ok")))
    dec = PE.decide([(0, "draft", 0, d)], ctx, b.mode)
    ev = dec.evaluated[0] if dec.evaluated else None
    return {"in_scope": ev is not None, "matched": bool(ev and ev.matched), "decision": dec.raw, "effective": dec.effective, "mode": b.mode, "explanation": dec.reason() if ev else "This policy does not apply to that agent/tool (out of scope)."}

class SimIn(BaseModel):
    definition: dict | None = None; policy_id: int | None = None; limit_traces: int = Field(default=100, ge=1, le=500)

@router.post("/policies/simulate")
def simulate_policy(b: SimIn, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    """Replay a policy (saved or draft) over recent real tool calls and report what it WOULD have done. Nothing is changed."""
    if b.policy_id:
        pol = _policy(db, p.workspace_id, b.policy_id); v = db.scalar(select(PolicyVersionRow).where(PolicyVersionRow.policy_id == pol.id, PolicyVersionRow.version == pol.current_version)); d, name = PE.PolicyDef.model_validate(v.definition), pol.name
    elif b.definition: d, name = _validate(b.definition), "draft"
    else: raise HTTPException(422, "Give either policy_id or definition.")
    counts = {a: 0 for a in PE.PRECEDENCE}; samples = []; looked = 0; traces = db.scalars(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id).order_by(TraceRow.created_at.desc()).limit(b.limit_traces)).all()
    for t in traces:
        evs = sorted(load_events(db, p.workspace_id, t.trace_id), key=lambda e: e.step_index)
        for i, e in enumerate(evs):
            if e.event_type != EventType.TOOL_CALL: continue
            looked += 1
            appr = any(x.event_type == EventType.HUMAN_APPROVAL and x.metadata.get("approved") is True and x.metadata.get("approves_tool") == e.tool_name for x in evs[:i])
            m = PE.evaluate_policy(0, name, 0, d, PE.Context(agent=e.agent_name, tool=e.tool_name or "", args=e.tool_input or {}, consequential=bool(e.metadata.get("consequential")), history=evs[:i], approval_ok=appr))
            if m and m.matched and not m.satisfied_by_approval:
                counts[d.action] += 1
                if len(samples) < 20: samples.append({"trace_id": t.trace_id, "step_index": e.step_index, "tool": e.tool_name, "explanation": m.explanation})
    return {"policy": name, "action": d.action, "tool_calls_examined": looked, "traces_examined": len(traces), "would_trigger": sum(counts.values()), "by_action": {k: v for k, v in counts.items() if v}, "samples": samples,
            "note": "A what-if replay over stored runs. Nothing was blocked or changed."}

@router.get("/policies/{pid}")
def get_policy(pid: int, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)): return _pdump(db, _policy(db, p.workspace_id, pid), True)

@router.put("/policies/{pid}")
def update_policy(pid: int, b: PolicyUpdate, p: Principal = Depends(needs("edit_policies")), db: Session = Depends(get_db)):
    row = _policy(db, p.workspace_id, pid)
    if b.description is not None: row.description = b.description
    if b.category is not None: row.category = b.category
    if b.definition is not None:
        newdef = _validate(b.definition).model_dump(mode="json"); cur = db.scalar(select(PolicyVersionRow).where(PolicyVersionRow.policy_id == pid, PolicyVersionRow.version == row.current_version))
        if newdef != cur.definition:
            row.current_version = max(v.version for v in _versions(db, pid)) + 1
            db.add(PolicyVersionRow(policy_id=pid, version=row.current_version, definition=newdef, note=b.note or "Edited", created_by=p.email))
    db.commit(); audit(db, p, "policy_updated", row.name, {"version": row.current_version}); return _pdump(db, row, True)

class Toggle(BaseModel): enabled: bool
@router.delete("/policies/{pid}")
def delete_policy(pid: int, p: Principal = Depends(needs("edit_policies")), db: Session = Depends(get_db)):
    row = _policy(db, p.workspace_id, pid); name = row.name
    for v in db.scalars(select(PolicyVersionRow).where(PolicyVersionRow.policy_id == pid)): db.delete(v)
    db.delete(row); db.commit(); audit(db, p, "policy_deleted", name)      # past decisions stay in the log: they are the audit trail
    return {"deleted": 1}

@router.post("/policies/{pid}/toggle")
def toggle_policy(pid: int, b: Toggle, p: Principal = Depends(needs("edit_policies")), db: Session = Depends(get_db)):
    row = _policy(db, p.workspace_id, pid); row.enabled = b.enabled; db.commit(); audit(db, p, "policy_toggled", row.name, {"enabled": b.enabled}); return _pdump(db, row)

class Rollback(BaseModel): version: int
@router.post("/policies/{pid}/rollback")
def rollback_policy(pid: int, b: Rollback, p: Principal = Depends(needs("edit_policies")), db: Session = Depends(get_db)):
    row = _policy(db, p.workspace_id, pid); old = db.scalar(select(PolicyVersionRow).where(PolicyVersionRow.policy_id == pid, PolicyVersionRow.version == b.version))
    if not old: raise HTTPException(404, "That version does not exist.")
    row.current_version = max(v.version for v in _versions(db, pid)) + 1   # history is never rewritten: a rollback is a NEW version
    db.add(PolicyVersionRow(policy_id=pid, version=row.current_version, definition=old.definition, note=f"Rolled back to v{b.version}", created_by=p.email)); db.commit()
    audit(db, p, "policy_updated", row.name, {"rollback_to": b.version}); return _pdump(db, row, True)

# ======================= approvals =======================
def expire_approvals(db: Session, ws: int) -> None:
    for a in db.scalars(select(ApprovalRow).where(ApprovalRow.workspace_id == ws, ApprovalRow.status == "pending")):
        if a.expires_at and aware_ok(a.expires_at) < _now(): a.status, a.decision_note = "expired", "No decision in time; treated as rejected."
    db.commit()

def _adump(a: ApprovalRow) -> dict:
    return {"id": a.id, "trace_id": a.trace_id, "agent_name": a.agent_name, "tool_name": a.tool_name, "arguments": a.arguments, "reason": a.reason, "policy_name": a.policy_name, "evidence_steps": a.evidence_steps,
            "status": a.status, "consumed": a.consumed, "decided_by": a.decided_by, "decision_note": a.decision_note, "decided_at": a.decided_at, "expires_at": a.expires_at, "created_at": a.created_at}

@router.get("/approvals")
def list_approvals(status: str | None = None, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    expire_approvals(db, p.workspace_id)
    q = select(ApprovalRow).where(ApprovalRow.workspace_id == p.workspace_id); ac = by_trace(ApprovalRow.trace_id, p.workspace_id, data)
    if ac is not None: q = q.where(ac)
    if status: q = q.where(ApprovalRow.status == status)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    pq = select(func.count()).select_from(ApprovalRow).where(ApprovalRow.workspace_id == p.workspace_id, ApprovalRow.status == "pending")
    pend = db.scalar(pq if ac is None else pq.where(ac))
    return {"total": total, "pending": pend, "items": [_adump(a) for a in db.scalars(q.order_by(ApprovalRow.created_at.desc()).limit(limit).offset(offset))]}

def _approval(db: Session, ws: int, aid: int) -> ApprovalRow:
    a = db.get(ApprovalRow, aid)
    if not a or a.workspace_id != ws: raise HTTPException(404, "Approval request not found.")
    return a

@router.get("/approvals/{aid}")
def get_approval(aid: int, p: Principal = Depends(require_agent), db: Session = Depends(get_db)):
    expire_approvals(db, p.workspace_id); a = _approval(db, p.workspace_id, aid); out = _adump(a)
    if p.role != "agent":    # humans also see the relevant trace events as evidence
        evs = [e for e in load_events(db, p.workspace_id, a.trace_id) if e.step_index in set(a.evidence_steps)]
        out["evidence"] = [e.model_dump(mode="json") for e in evs]
    return out

class Decision(BaseModel):
    decision: Literal["approve", "reject", "request_changes"]; note: str = Field(default="", max_length=500)
@router.post("/approvals/{aid}/decision")
def decide_approval(aid: int, b: Decision, p: Principal = Depends(needs("decide_approvals")), db: Session = Depends(get_db)):
    expire_approvals(db, p.workspace_id); a = _approval(db, p.workspace_id, aid)
    if a.status != "pending": raise HTTPException(409, f"This request is already {a.status}.")
    if b.decision != "approve" and not b.note.strip(): raise HTTPException(422, "Please explain why, so the agent's owner knows what to fix.")
    a.status = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}[b.decision]; a.decided_by, a.decision_note, a.decided_at = p.email, b.note or None, _now(); db.commit()
    audit(db, p, "approval_decided", f"#{a.id} {a.tool_name}", {"decision": b.decision, "trace": a.trace_id}); return _adump(a)

# ======================= runtime check =======================
class CheckIn(BaseModel):
    trace_id: str = Field(min_length=1, max_length=128); agent_name: str = Field(min_length=1, max_length=128); run_id: str | None = None
    tool_name: str = Field(min_length=1, max_length=128); arguments: dict = Field(default_factory=dict)
    mode: Mode = "enforce"; consequential: bool = False; read_only: bool = False; actor_role: str | None = None; arg_schema: dict | None = None
    approval_id: int | None = None; step_index: int | None = None

@router.post("/runtime/check")
def runtime_check(b: CheckIn, p: Principal = Depends(require_agent), db: Session = Depends(get_db)):
    """Called by the SDK BEFORE a tool runs. Returns whether it may run. In enforce mode the SDK must not run the tool unless allowed=true."""
    ws = p.workspace_id; cfg = load_config(db, ws); expire_approvals(db, ws)
    events = sorted(load_events(db, ws, b.trace_id), key=lambda e: e.step_index) if get_trace(db, ws, b.trace_id) else []
    h = sha(_canon(b.arguments)); appr = db.get(ApprovalRow, b.approval_id) if b.approval_id else None
    valid = bool(appr and appr.workspace_id == ws and appr.trace_id == b.trace_id and appr.tool_name == b.tool_name and appr.args_hash == h and appr.status == "approved" and not appr.consumed)
    ctx = PE.Context(agent=b.agent_name, tool=b.tool_name, args=b.arguments, consequential=b.consequential, read_only=b.read_only, actor_role=b.actor_role, history=events, approval_ok=valid)
    dec = PE.decide(active_policies(db, ws), ctx, b.mode); eff, reason = dec.effective, dec.reason()
    prev = db.scalar(select(ApprovalRow).where(ApprovalRow.workspace_id == ws, ApprovalRow.trace_id == b.trace_id, ApprovalRow.tool_name == b.tool_name, ApprovalRow.args_hash == h,
                                               ApprovalRow.status.in_(["rejected", "changes_requested"])).order_by(ApprovalRow.id.desc()))
    if eff == "REQUIRE_APPROVAL" and prev and not valid and b.mode == "enforce":
        eff, reason = "BLOCK", f"A human already {prev.status.replace('_', ' ')} this exact action ({prev.decision_note or 'no note'}). It stays blocked until something changes."
    risk = assess(events, cfg, {"tool": b.tool_name, "args": b.arguments, "consequential": b.consequential, "arg_schema": b.arg_schema, "approved": valid})
    approval_id = None; approval_status = None
    if eff == "REQUIRE_APPROVAL":
        pend = db.scalar(select(ApprovalRow).where(ApprovalRow.workspace_id == ws, ApprovalRow.trace_id == b.trace_id, ApprovalRow.tool_name == b.tool_name, ApprovalRow.args_hash == h, ApprovalRow.status == "pending"))
        if pend is None:
            first = next((m for m in dec.matches if m.action == "REQUIRE_APPROVAL" and not m.satisfied_by_approval), None)
            pend = ApprovalRow(workspace_id=ws, trace_id=b.trace_id, agent_name=b.agent_name, tool_name=b.tool_name, arguments=redact(b.arguments), args_hash=h, reason=reason, policy_name=first.name if first else None,
                               evidence_steps=[e.step_index for e in events[-6:]], expires_at=_now() + timedelta(minutes=cfg.approval_timeout_minutes)); db.add(pend); db.flush()
        approval_id, approval_status = pend.id, pend.status
    allowed = b.mode != "enforce" or eff in ("ALLOW", "WARN")
    if valid and allowed: appr.consumed = True                   # an approval authorises exactly one execution
    step = b.step_index if b.step_index is not None else (events[-1].step_index + 1 if events else 0); rid = b.run_id or b.trace_id
    for i, d_ in enumerate(dec.evaluated):
        db.add(PolicyEvalRow(workspace_id=ws, trace_id=b.trace_id, step_index=step, policy_id=d_.policy_id, policy_name=d_.name, version=d_.version, tool_name=b.tool_name, matched=d_.matched, action=d_.action,
                             effective=eff if d_.matched else "ALLOW", mode=b.mode, explanation=d_.explanation, context={"args": redact(b.arguments), "consequential": b.consequential, "history_steps": len(events), "approval_valid": valid}))
    new = [Event(trace_id=b.trace_id, run_id=rid, event_id=f"pc-{uuid.uuid4().hex[:10]}", agent_name=b.agent_name, event_type=EventType.POLICY_CHECK, timestamp=_now(), step_index=step, tool_name=b.tool_name,
                 status=Status.ERROR if eff == "BLOCK" else Status.OK, metadata={"decision": dec.raw, "effective": eff, "mode": b.mode, "reason": reason[:400], "approval_id": approval_id,
                 "matches": [{"policy": m.name, "action": m.action, "explanation": m.explanation[:200]} for m in dec.matches if not m.satisfied_by_approval], "risk_score": risk.score})]
    if risk.score >= cfg.risk_alert_threshold and risk.predicted_failure:
        new.append(Event(trace_id=b.trace_id, run_id=rid, event_id=f"rk-{uuid.uuid4().hex[:10]}", agent_name=b.agent_name, event_type=EventType.RISK_DETECTED, timestamp=_now(), step_index=step + 1,
                         tool_name=b.tool_name, metadata=risk.dump()))
    ingest(db, ws, b.trace_id, new)
    return {"decision": dec.raw, "effective": eff, "mode": b.mode, "allowed": allowed, "reason": reason, "matches": [m.dump() for m in dec.matches], "approval_request_id": approval_id, "approval_status": approval_status,
            "risk": risk.dump(), "consumed_steps": len(new), "check_event_id": new[0].event_id}

# ======================= risk, findings, agents =======================
@router.get("/risk/predictions")
def risk_predictions(trace_id: str | None = None, level: str | None = None, outcome: str | None = None, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                     p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    q = select(RiskPredictionRow).where(RiskPredictionRow.workspace_id == p.workspace_id)
    for col, v in ((RiskPredictionRow.trace_id, trace_id), (RiskPredictionRow.level, level), (RiskPredictionRow.outcome, outcome)):
        if v: q = q.where(col == v)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    return {"total": total, "items": [{"id": r.id, "trace_id": r.trace_id, "step_index": r.step_index, "score": r.score, "level": r.level, "predicted_failure": r.predicted_failure, "confidence": r.confidence, "evidence": r.evidence,
            "signals": r.signals, "recommended_action": r.recommended_action, "outcome": r.outcome, "lead_steps": r.lead_steps, "created_at": r.created_at} for r in db.scalars(q.order_by(RiskPredictionRow.score.desc(), RiskPredictionRow.id.desc()).limit(limit).offset(offset))]}

@router.get("/risk/metrics")
def risk_metrics(data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    ws = p.workspace_id; rc = by_trace(RiskPredictionRow.trace_id, ws, data); preds = list(db.scalars(select(RiskPredictionRow).where(RiskPredictionRow.workspace_id == ws, *([rc] if rc is not None else []))))
    res = [r for r in preds if r.outcome in ("occurred", "not_occurred")]; hit = [r for r in res if r.outcome == "occurred"]; hi = [r for r in res if r.level in ("high", "critical")]
    predictable = set(ACTION_FOR); fails = {(f.trace_id, f.category) for f in db.scalars(select(FindingRow).where(FindingRow.workspace_id == ws, *([by_trace(FindingRow.trace_id, ws, data)] if data != "all" else []))) if f.category in predictable}
    caught = {(r.trace_id, r.predicted_failure) for r in hit} & fails; leads = [r.lead_steps for r in hit if r.lead_steps is not None]
    f = lambda a, b: (a / b) if b else None
    return {"n_predictions": len(preds), "n_resolved": len(res), "n_pending": len(preds) - len(res), "precision": f(len(hit), len(res)), "n_failures": len(fails), "recall": f(len(caught), len(fails)),
            "avg_lead_steps": f(sum(leads), len(leads)), "warned_before_failure": f(sum(1 for x in leads if x > 0), len(leads)), "false_intervention_rate": f(sum(r.outcome == "not_occurred" for r in hi), len(hi)), "n_high_resolved": len(hi),
            "definitions": {"precision": "resolved warnings whose failure really appeared / resolved warnings", "recall": "(run, failure type) pairs that were warned about first / all such failures that happened",
                            "lead": "steps between the warning and the step where the failure became detectable (0 = caught just before the action ran)", "false_intervention": "high/critical warnings that were not followed by the failure / all resolved high/critical warnings"}}

@router.get("/risk/monitor")
def risk_monitor(limit: int = Query(25, ge=1, le=100), data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    ws = p.workspace_id; th = load_config(db, ws).risk_alert_threshold
    rows = db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == ws, TraceRow.risk_score >= th), data).order_by(TraceRow.risk_score.desc(), TraceRow.updated_at.desc()).limit(limit)).all(); out = []
    for t in rows:
        top = db.scalar(select(RiskPredictionRow).where(RiskPredictionRow.workspace_id == ws, RiskPredictionRow.trace_id == t.trace_id).order_by(RiskPredictionRow.score.desc()))
        out.append({"trace_id": t.trace_id, "agent_name": t.agent_name, "task": t.task, "outcome": t.outcome, "risk_score": t.risk_score, "mode": t.mode, "blocked_actions": t.blocked_actions, "updated_at": t.updated_at,
                    "prediction": {"level": top.level, "predicted_failure": top.predicted_failure, "confidence": top.confidence, "evidence": top.evidence, "recommended_action": top.recommended_action, "outcome": top.outcome, "step_index": top.step_index} if top else None})
    return {"threshold": th, "items": out}

@router.get("/findings")
def list_findings(severity: str | None = None, category: str | None = None, trace_id: str | None = None, source: str | None = None, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), data: Scope = "production",
                  p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    q = select(FindingRow).where(FindingRow.workspace_id == p.workspace_id); fc = by_trace(FindingRow.trace_id, p.workspace_id, data)
    if fc is not None: q = q.where(fc)
    for col, v in ((FindingRow.severity, severity), (FindingRow.category, category), (FindingRow.trace_id, trace_id), (FindingRow.source, source)):
        if v: q = q.where(col == v)
    total = db.scalar(select(func.count()).select_from(q.subquery())); rows = list(db.scalars(q.limit(5000)))
    rows.sort(key=lambda r: (SEV_RANK.get(r.severity, 0), r.detected_at), reverse=True)
    return {"total": total, "items": [{"id": r.id, "trace_id": r.trace_id, "event_id": r.event_id, "category": r.category, "label": FAIL_CATS.get(r.category, {}).get("label", r.category), "severity": r.severity, "confidence": r.confidence,
            "source": r.source, "rule": r.rule, "description": r.description, "evidence": r.evidence, "suggested_action": r.suggested_action, "detected_at": r.detected_at} for r in rows[offset:offset + limit]]}

class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=128); description: str = Field(default="", max_length=500); environment: str = Field(default="production", max_length=32)
@router.get("/agents/starter")
def agent_starter(request: Request, name: str = Query(min_length=1, max_length=128), p: Principal = Depends(needs("connect_agents"))):
    """A ready-to-run one-file starter for a person with no coding background. The page puts the key in; it is never sent here."""
    server = os.getenv("PUBLIC_API_URL") or str(request.base_url).rstrip("/")
    return {**starter_file(name, server, "PASTE_YOUR_KEY_HERE"), "server": server}

@router.get("/agents")
def agents(data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    ws = p.workspace_id; every = list(db.scalars(select(TraceRow).where(TraceRow.workspace_id == ws))); ts = list(db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == ws), data))); out = []
    for a in db.scalars(select(AgentRow).where(AgentRow.workspace_id == ws).order_by(AgentRow.name)):
        mine = [t for t in ts if t.agent_name == a.name]; tests = [t for t in every if t.agent_name == a.name and t.origin in SYNTHETIC]
        if data == "synthetic" and not mine: continue
        if data == "production" and (a.origin in SYNTHETIC) and not mine: continue      # an agent that only exists because of demo or sample runs is not a real agent
        recent = sorted(mine, key=lambda t: t.created_at, reverse=True)[:3]; last = recent[0].created_at if recent else None
        if last is not None and last.tzinfo is None: last = last.replace(tzinfo=timezone.utc)
        connection = ("quiet" if last and (datetime.now(timezone.utc) - last).days >= AGENT_QUIET_DAYS else "connected") if mine else "test_only" if tests else "waiting"
        open_problems = [f for f in db.scalars(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.resolved_at.is_(None), FindingRow.trace_id.in_([t.trace_id for t in mine] or [""])))]
        out.append({"integration": a.integration, "connection": connection, "quiet_after_days": AGENT_QUIET_DAYS, "open_problems": len(open_problems), "open_serious": sum(f.severity in P.SERIOUS for f in open_problems),
                    "recent_activity": [{"trace_id": t.trace_id, "headline": t.headline or t.task, "outcome": t.outcome, "status": t.status, "at": t.created_at} for t in recent],
                    "id": a.id, "name": a.name, "description": a.description, "environment": a.environment, "last_seen_at": a.last_seen_at, "origin": a.origin or "production", "test_runs": len(tests), "runs": len(mine), "flagged_runs": sum(t.status == "flagged" for t in mine),
                    "blocked_actions": sum(t.blocked_actions for t in mine), "avg_risk": round(sum(t.risk_score for t in mine) / len(mine), 1) if mine else None})
    return {"items": out}
@router.post("/agents", status_code=201)
def register_agent(b: AgentIn, p: Principal = Depends(needs("connect_agents")), db: Session = Depends(get_db)):
    if db.scalar(select(AgentRow).where(AgentRow.workspace_id == p.workspace_id, AgentRow.name == b.name)): raise HTTPException(409, "An agent with this name is already registered.")
    a = AgentRow(workspace_id=p.workspace_id, name=b.name, description=b.description, environment=b.environment); db.add(a); db.commit(); return {"id": a.id, "name": a.name}


class ResolveIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)

@router.get("/problems")
def problems(group: str | None = Query(None, pattern="^(critical|warning|resolved)$"), agent: str | None = None, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), data: Scope = "production",
             p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    return P.list_problems(db, p.workspace_id, data, group, agent, limit, offset)

@router.post("/problems/{fid}/resolve")
def resolve_problem(fid: str, b: ResolveIn, p: Principal = Depends(needs("resolve_problems")), db: Session = Depends(get_db)):
    if P.resolve(db, p.workspace_id, fid, p.email, b.note) is None: raise HTTPException(404, "Problem not found.")
    db.commit(); audit(db, p, "problem_resolved", fid, {"note": b.note}); return {"resolved": True}

@router.post("/problems/{fid}/reopen")
def reopen_problem(fid: str, p: Principal = Depends(needs("resolve_problems")), db: Session = Depends(get_db)):
    if P.reopen(db, p.workspace_id, fid) is None: raise HTTPException(404, "Problem not found.")
    db.commit(); audit(db, p, "problem_reopened", fid); return {"resolved": False}

@router.get("/activity/timeline")
def activity_timeline(runs: int = Query(15, ge=1, le=50), offset: int = Query(0, ge=0), data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    return TL.build(db, p.workspace_id, data, runs, offset)
