import os
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.auth_routes import user_dict
from app.api.deps import Principal, audit, get_db, require
from app.auth import EMAIL_RE, hash_password, new_api_key, password_problem, sha
from app.catalog import ACTIVITY, SECURITY_ACTIONS
from app.db.models import ApiKeyRow, AuditRow, BenchmarkRow, SessionRow, UserRow, WorkspaceRow
from app.services import settings as S
from app.services.ingest import refresh_all
from app.services.retention import purge_older_than

router = APIRouter(prefix="/api/v1", tags=["admin"])
Role = Literal["viewer", "member", "admin"]

class NewUser(BaseModel):
    email: str = Field(max_length=254); name: str = Field(default="", max_length=120); role: Role = "viewer"; password: str = Field(max_length=200)
class UserPatch(BaseModel):
    role: Role | None = None; is_active: bool | None = None; name: str | None = Field(default=None, max_length=120)
class PwReset(BaseModel):
    new_password: str = Field(max_length=200)
class NewKey(BaseModel):
    name: str = Field(min_length=1, max_length=80)
class SettingsUpdate(BaseModel):
    values: dict = Field(default_factory=dict); disabled_rules: list[str] | None = None
class NewWorkspace(BaseModel):
    name: str = Field(min_length=2, max_length=120); admin_email: str = Field(max_length=254); admin_name: str = Field(default="", max_length=120); admin_password: str = Field(max_length=200)

def _admins_left(db: Session, ws: int, excluding: int) -> int:
    return db.scalar(select(func.count()).select_from(UserRow).where(UserRow.workspace_id == ws, UserRow.role == "admin", UserRow.is_active.is_(True), UserRow.id != excluding))

def _user(db: Session, p: Principal, uid: int) -> UserRow:
    u = db.get(UserRow, uid)
    if not u or (u.workspace_id or 1) != p.workspace_id: raise HTTPException(404, "User not found.")   # other workspaces' users do not exist for you
    return u

# ---------- workspaces ----------
@router.get("/workspaces/current")
def current_workspace(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    w = db.get(WorkspaceRow, p.workspace_id); return {"id": w.id, "name": w.name, "created_at": w.created_at}

@router.post("/workspaces", status_code=201)
def create_workspace(b: NewWorkspace, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    first = db.scalar(select(func.min(WorkspaceRow.id)))
    if p.workspace_id != first: raise HTTPException(403, "Only the platform (first) workspace's admins can create workspaces.")
    email = b.admin_email.strip().lower()
    if not EMAIL_RE.match(email): raise HTTPException(422, "Enter a valid email address.")
    if (m := password_problem(b.admin_password, email)): raise HTTPException(422, m)
    if db.scalar(select(WorkspaceRow).where(WorkspaceRow.name == b.name.strip())): raise HTTPException(409, "A workspace with this name already exists.")
    if db.scalar(select(UserRow).where(UserRow.email == email)): raise HTTPException(409, "A user with this email already exists.")
    w = WorkspaceRow(name=b.name.strip()); db.add(w); db.flush()
    u = UserRow(workspace_id=w.id, email=email, name=b.admin_name.strip() or email.split("@")[0], role="admin", password_hash=hash_password(b.admin_password)); db.add(u); db.commit()
    audit(db, p, "workspace_created", w.name, {"admin": email}); return {"id": w.id, "name": w.name, "admin": user_dict(u)}

# ---------- users ----------
@router.get("/users")
def users(p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    return {"items": [user_dict(u) for u in db.scalars(select(UserRow).where(UserRow.workspace_id == p.workspace_id).order_by(UserRow.created_at))]}

@router.post("/users", status_code=201)
def create_user(b: NewUser, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    email = b.email.strip().lower()
    if not EMAIL_RE.match(email): raise HTTPException(422, "Enter a valid email address.")
    if (m := password_problem(b.password, email)): raise HTTPException(422, m)
    if db.scalar(select(UserRow).where(UserRow.email == email)): raise HTTPException(409, "A user with this email already exists.")
    u = UserRow(workspace_id=p.workspace_id, email=email, name=b.name.strip() or email.split("@")[0], role=b.role, password_hash=hash_password(b.password)); db.add(u); db.commit()
    audit(db, p, "user_created", email, {"role": b.role}); return user_dict(u)

@router.patch("/users/{uid}")
def patch_user(uid: int, b: UserPatch, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    u = _user(db, p, uid)
    losing_admin = u.role == "admin" and ((b.role and b.role != "admin") or b.is_active is False)
    if losing_admin and _admins_left(db, p.workspace_id, u.id) == 0: raise HTTPException(409, "There must always be at least one active admin.")
    changes = {}
    if b.role and b.role != u.role: changes["role"] = b.role; u.role = b.role
    if b.is_active is not None and b.is_active != u.is_active:
        changes["is_active"] = b.is_active; u.is_active = b.is_active
        if not b.is_active:
            for s in db.scalars(select(SessionRow).where(SessionRow.user_id == u.id)): s.revoked = True
    if b.name is not None: u.name = b.name.strip()
    db.commit(); audit(db, p, "user_updated", u.email, changes); return user_dict(u)

@router.post("/users/{uid}/reset-password")
def reset_pw(uid: int, b: PwReset, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    u = _user(db, p, uid)
    if (m := password_problem(b.new_password, u.email)): raise HTTPException(422, m)
    u.password_hash = hash_password(b.new_password); u.failed_attempts = 0; u.locked_until = None
    for s in db.scalars(select(SessionRow).where(SessionRow.user_id == u.id)): s.revoked = True
    db.commit(); audit(db, p, "password_reset", u.email); return {"ok": True}

# ---------- API keys (agent keys; hashed at rest, scoped to this workspace) ----------
def key_dict(k: ApiKeyRow) -> dict:
    return {"id": k.id, "name": k.name, "prefix": k.prefix, "created_by": k.created_by, "created_at": k.created_at, "last_used_at": k.last_used_at, "revoked_at": k.revoked_at}

def _key(db: Session, p: Principal, kid: int) -> ApiKeyRow:
    k = db.get(ApiKeyRow, kid)
    if not k or (k.workspace_id or 1) != p.workspace_id: raise HTTPException(404, "API key not found.")
    return k

def _mint(db: Session, p: Principal, name: str) -> tuple[ApiKeyRow, str]:
    plain = new_api_key(); k = ApiKeyRow(workspace_id=p.workspace_id, name=name.strip(), prefix=plain[:10], key_hash=sha(plain), created_by=p.email); db.add(k); db.commit(); return k, plain

@router.get("/api-keys")
def keys(p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    return {"items": [key_dict(k) for k in db.scalars(select(ApiKeyRow).where(ApiKeyRow.workspace_id == p.workspace_id).order_by(ApiKeyRow.created_at.desc()))]}

@router.post("/api-keys", status_code=201)
def create_key(b: NewKey, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    k, plain = _mint(db, p, b.name); audit(db, p, "api_key_created", k.name)
    return {**key_dict(k), "key": plain, "note": "Copy this key now. It is shown only once and cannot be recovered."}

@router.post("/api-keys/{kid}/rotate", status_code=201)
def rotate_key(kid: int, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    old = _key(db, p, kid)
    if old.revoked_at: raise HTTPException(409, "This key is already revoked.")
    old.revoked_at = datetime.now(timezone.utc); db.commit()
    k, plain = _mint(db, p, old.name); audit(db, p, "api_key_rotated", k.name)
    return {**key_dict(k), "key": plain, "replaces": old.id, "note": "The old key stopped working immediately. Copy the new key now; it is shown only once."}

@router.delete("/api-keys/{kid}")
def revoke_key(kid: int, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    k = _key(db, p, kid); k.revoked_at = k.revoked_at or datetime.now(timezone.utc); db.commit(); audit(db, p, "api_key_revoked", k.name); return key_dict(k)

# ---------- settings ----------
def system_info(request: Request, p: Principal) -> dict:
    base = os.getenv("PUBLIC_API_URL") or str(request.base_url).rstrip("/")
    snippet = (f'from agentguard import AgentGuard\n\nguard = AgentGuard(api_url="{base}", api_key="YOUR_API_KEY", mode="enforce")   # observe | warn | enforce\n\n'
               '@guard.tool("issue_refund", consequential=True)\ndef issue_refund(order_id, amount): ...\n\n'
               'with guard.trace(agent_name="AGENT_NAME", task="Refund order ORD-101", required_tools=["get_order"]) as run:\n'
               '    order = run.tools.get_order(order_id="ORD-101")        # every call is checked BEFORE it runs\n'
               '    run.tools.issue_refund(order_id="ORD-101", amount=20)  # may be blocked, or wait for a human approval\n'
               '    run.finish(claimed_success=True)')
    st = request.app.state
    return {"version": request.app.version, "auth_required": st.auth_required, "session_hours": int(os.getenv("SESSION_HOURS", "12")),
            "ai": {"enabled": st.llm_enabled, "provider": os.getenv("LLM_PROVIDER") or None}, "max_events_per_request": st.max_events,
            "redaction": ["passwords, tokens and API keys", "email addresses", "social security numbers", "text longer than 2,000 characters is cut"],
            "connect": {"base_url": base, "snippet": snippet, "install": "pip install -e sdk"}}

@router.get("/settings")
def get_settings(request: Request, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    return {**S.describe(db, p.workspace_id), "system": system_info(request, p)}

@router.put("/settings")
def put_settings(b: SettingsUpdate, request: Request, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    try: changes = S.update(db, p.workspace_id, b.values, b.disabled_rules, p.email)
    except ValueError as e: raise HTTPException(422, str(e))
    if p.workspace_id == 1: request.app.state.cfg = S.load_config(db, 1)
    if changes:
        refresh_all(db, p.workspace_id)   # detection settings affect every stored summary
        audit(db, p, "settings_updated", None, {"changes": changes})
    return {"changes": changes, **S.describe(db, p.workspace_id), "system": system_info(request, p)}

@router.post("/settings/cleanup")
def cleanup(p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    n = purge_older_than(db, S.load_config(db, p.workspace_id).retention_days, p.workspace_id)
    audit(db, p, "retention_run", None, {"deleted_traces": n}); return {"deleted_traces": n}

# ---------- history ----------
@router.get("/history/activity")
def activity(kind: Literal["all", "activity", "security"] = "all", action: str | None = None, limit: int = Query(30, ge=1, le=200), offset: int = Query(0, ge=0),
             p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    q = select(AuditRow).where(AuditRow.workspace_id == p.workspace_id)
    if p.role != "admin": q = q.where(AuditRow.kind == "activity")   # security events are admin-only
    elif kind != "all": q = q.where(AuditRow.kind == kind)
    if action: q = q.where(AuditRow.action == action)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(AuditRow.ts.desc()).limit(limit).offset(offset))
    acts = {k: {"label": v, "kind": "security" if k in SECURITY_ACTIONS else "activity"} for k, v in ACTIVITY.items() if p.role == "admin" or k not in SECURITY_ACTIONS}
    return {"total": total, "actions": acts, "items": [{"id": r.id, "ts": r.ts, "kind": r.kind, "actor": r.actor, "action": r.action, "label": ACTIVITY.get(r.action, r.action), "target": r.target, "detail": r.detail} for r in rows]}

@router.get("/history/benchmarks")
def bench_history(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    rows = db.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "completed", BenchmarkRow.workspace_id == p.workspace_id).order_by(BenchmarkRow.created_at)).all()
    out = []
    for r in rows:
        m = r.result["metrics"]
        out.append({"run_id": r.run_id, "at": r.finished_at or r.created_at, "n_scenarios": m["n_scenarios"], "precision": m["detection"]["micro_precision"], "recall": m["detection"]["micro_recall"],
                    "false_alarm_rate": m["detection"]["false_positive_rate"], "safe_with": m["outcomes"]["protected_safe_outcome"], "safe_without": m["outcomes"]["baseline_safe_outcome"],
                    "config": (r.result.get("config") or {}), "scope": (r.params or {}).get("scenario_ids") and "selected scenarios" or "all scenarios"})
    return {"items": out}
