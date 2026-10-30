import os
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.auth_routes import user_dict
from app.api.deps import Principal, audit, get_db, require
from app.auth import EMAIL_RE, hash_password, new_api_key, password_problem
from app.catalog import ACTIVITY, SECURITY_ACTIONS
from app.db.models import ApiKeyRow, AuditRow, BenchmarkRow, SessionRow, UserRow
from app.services import settings as S
from app.services.ingest import refresh_all
from app.services.retention import purge_older_than
from datetime import datetime, timezone

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

def _admins_left(db: Session, excluding: int) -> int:
    return db.scalar(select(func.count()).select_from(UserRow).where(UserRow.role == "admin", UserRow.is_active.is_(True), UserRow.id != excluding))

# ---------- users ----------
@router.get("/users")
def users(_: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    return {"items": [user_dict(u) for u in db.scalars(select(UserRow).order_by(UserRow.created_at))]}

@router.post("/users", status_code=201)
def create_user(b: NewUser, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    email = b.email.strip().lower()
    if not EMAIL_RE.match(email): raise HTTPException(422, "Enter a valid email address.")
    if (m := password_problem(b.password, email)): raise HTTPException(422, m)
    if db.scalar(select(UserRow).where(UserRow.email == email)): raise HTTPException(409, "A user with this email already exists.")
    u = UserRow(email=email, name=b.name.strip() or email.split("@")[0], role=b.role, password_hash=hash_password(b.password)); db.add(u); db.commit()
    audit(db, p, "user_created", email, {"role": b.role}); return user_dict(u)

@router.patch("/users/{uid}")
def patch_user(uid: int, b: UserPatch, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    u = db.get(UserRow, uid)
    if not u: raise HTTPException(404, "User not found.")
    losing_admin = u.role == "admin" and ((b.role and b.role != "admin") or b.is_active is False)
    if losing_admin and _admins_left(db, u.id) == 0: raise HTTPException(409, "There must always be at least one active admin.")
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
    u = db.get(UserRow, uid)
    if not u: raise HTTPException(404, "User not found.")
    if (m := password_problem(b.new_password, u.email)): raise HTTPException(422, m)
    u.password_hash = hash_password(b.new_password); u.failed_attempts = 0; u.locked_until = None
    for s in db.scalars(select(SessionRow).where(SessionRow.user_id == u.id)): s.revoked = True
    db.commit(); audit(db, p, "password_reset", u.email); return {"ok": True}

# ---------- API keys ----------
def key_dict(k: ApiKeyRow) -> dict:
    return {"id": k.id, "name": k.name, "prefix": k.prefix, "created_by": k.created_by, "created_at": k.created_at, "last_used_at": k.last_used_at, "revoked_at": k.revoked_at}

@router.get("/api-keys")
def keys(_: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    return {"items": [key_dict(k) for k in db.scalars(select(ApiKeyRow).order_by(ApiKeyRow.created_at.desc()))]}

@router.post("/api-keys", status_code=201)
def create_key(b: NewKey, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    from app.auth import sha
    plain = new_api_key(); k = ApiKeyRow(name=b.name.strip(), prefix=plain[:10], key_hash=sha(plain), created_by=p.email); db.add(k); db.commit()
    audit(db, p, "api_key_created", k.name)
    return {**key_dict(k), "key": plain, "note": "Copy this key now. It is shown only once and cannot be recovered."}

@router.delete("/api-keys/{kid}")
def revoke_key(kid: int, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    k = db.get(ApiKeyRow, kid)
    if not k: raise HTTPException(404, "API key not found.")
    k.revoked_at = k.revoked_at or datetime.now(timezone.utc); db.commit(); audit(db, p, "api_key_revoked", k.name); return key_dict(k)

# ---------- settings ----------
def system_info(request: Request) -> dict:
    base = os.getenv("PUBLIC_API_URL") or str(request.base_url).rstrip("/")
    snippet = (f'from agentguard_sdk import Tracer, http_transport\n\ntracer = Tracer("my-agent", http_transport("{base}", api_key="YOUR_API_KEY"))\n'
               'with tracer.run(required_tools=["lookup_order"]) as run:\n    run.call("lookup_order", {"order_id": 1}, fn=lookup_order, read_only=True,\n'
               '             arg_schema={"required": ["order_id"], "types": {"order_id": "integer"}})\n    run.approval("issue_refund", approved=True)\n'
               '    run.call("issue_refund", {"amount": 20}, fn=issue_refund, consequential=True)\n    run.finish(claimed_success=True)')
    st = request.app.state
    return {"version": request.app.version, "auth_required": st.auth_required, "session_hours": int(os.getenv("SESSION_HOURS", "12")),
            "ai": {"enabled": st.llm_enabled, "provider": os.getenv("LLM_PROVIDER") or None}, "max_events_per_request": st.max_events,
            "redaction": ["passwords, tokens and API keys", "email addresses", "social security numbers", "text longer than 2,000 characters is cut"],
            "connect": {"base_url": base, "snippet": snippet, "install": "pip install -e sdk"}}

@router.get("/settings")
def get_settings(request: Request, _: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    return {**S.describe(db), "system": system_info(request)}

@router.put("/settings")
def put_settings(b: SettingsUpdate, request: Request, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    try: changes = S.update(db, b.values, b.disabled_rules, p.email)
    except ValueError as e: raise HTTPException(422, str(e))
    request.app.state.cfg = S.load_config(db)
    if changes:
        refresh_all(db)   # detection settings affect every stored summary
        audit(db, p, "settings_updated", None, {"changes": changes})
    return {"changes": changes, **S.describe(db), "system": system_info(request)}

@router.post("/settings/cleanup")
def cleanup(request: Request, p: Principal = Depends(require("admin")), db: Session = Depends(get_db)):
    n = purge_older_than(db, request.app.state.cfg.retention_days)
    audit(db, p, "retention_run", None, {"deleted_traces": n}); return {"deleted_traces": n}

# ---------- history ----------
@router.get("/history/activity")
def activity(kind: Literal["all", "activity", "security"] = "all", action: str | None = None, limit: int = Query(30, ge=1, le=200), offset: int = Query(0, ge=0),
             p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    q = select(AuditRow)
    if p.role != "admin": q = q.where(AuditRow.kind == "activity")   # security events are admin-only
    elif kind != "all": q = q.where(AuditRow.kind == kind)
    if action: q = q.where(AuditRow.action == action)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(AuditRow.ts.desc()).limit(limit).offset(offset))
    acts = {k: {"label": v, "kind": "security" if k in SECURITY_ACTIONS else "activity"} for k, v in ACTIVITY.items() if p.role == "admin" or k not in SECURITY_ACTIONS}
    return {"total": total, "actions": acts, "items": [{"id": r.id, "ts": r.ts, "kind": r.kind, "actor": r.actor, "action": r.action, "label": ACTIVITY.get(r.action, r.action), "target": r.target, "detail": r.detail} for r in rows]}

@router.get("/history/benchmarks")
def bench_history(_: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
    rows = db.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "completed").order_by(BenchmarkRow.created_at)).all()
    out = []
    for r in rows:
        m = r.result["metrics"]
        out.append({"run_id": r.run_id, "at": r.finished_at or r.created_at, "n_scenarios": m["n_scenarios"], "precision": m["detection"]["micro_precision"], "recall": m["detection"]["micro_recall"],
                    "false_alarm_rate": m["detection"]["false_positive_rate"], "safe_with": m["outcomes"]["protected_safe_outcome"], "safe_without": m["outcomes"]["baseline_safe_outcome"],
                    "config": (r.result.get("config") or {}), "scope": (r.params or {}).get("scenario_ids") and "selected scenarios" or "all scenarios"})
    return {"items": out}
