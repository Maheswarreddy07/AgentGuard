import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.deps import Principal, aware, audit, bearer, get_db, principal
from app.catalog import UI
from app.auth import EMAIL_RE, burn_time, hash_password, min_password_length, new_session_token, password_problem, sha, verify_password
from app.db.models import SessionRow, UserRow, WorkspaceRow

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

class Creds(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)

class Setup(Creds):
    name: str = Field(default="", max_length=120)

class ChangePw(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)

def user_dict(u: UserRow) -> dict:
    return {"id": u.id, "workspace_id": u.workspace_id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active, "created_at": u.created_at, "last_login_at": u.last_login_at}

def session_hours() -> int: return int(os.getenv("SESSION_HOURS", "12"))

def open_session(db: Session, request: Request, u: UserRow) -> dict:
    tok = new_session_token(); exp = datetime.now(timezone.utc) + timedelta(hours=session_hours())
    db.add(SessionRow(token_hash=sha(tok), user_id=u.id, expires_at=exp, ip=request.client.host if request.client else None, user_agent=(request.headers.get("user-agent") or "")[:200]))
    u.last_login_at = datetime.now(timezone.utc); u.failed_attempts = 0; u.locked_until = None; db.commit()
    return {"token": tok, "expires_at": exp, "user": user_dict(u)}

@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).select_from(UserRow))
    return {"auth_required": request.app.state.auth_required, "setup_required": request.app.state.auth_required and n == 0,
            "session_hours": session_hours(), "min_password_length": min_password_length(), "ui": {"login": UI["login"], "shell": UI["shell"]}}

@router.post("/setup", status_code=201)
def setup(body: Setup, request: Request, db: Session = Depends(get_db)):
    if not request.app.state.auth_required:
        raise HTTPException(409, "Authentication is turned off on this server.")
    if db.scalar(select(func.count()).select_from(UserRow)):
        raise HTTPException(409, "Setup is already complete. Please sign in.")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email): raise HTTPException(422, "Enter a valid email address.")
    if (msg := password_problem(body.password, email)): raise HTTPException(422, msg)
    ws = db.scalar(select(WorkspaceRow).order_by(WorkspaceRow.id)) or WorkspaceRow(name="Default workspace")
    db.add(ws); db.flush()
    u = UserRow(workspace_id=ws.id, email=email, name=body.name.strip() or email.split("@")[0], password_hash=hash_password(body.password), role="admin")
    db.add(u); db.commit()
    audit(db, Principal(kind="user", email=email, role="admin", workspace_id=ws.id), "setup_completed")
    return open_session(db, request, u)

@router.post("/login")
def login(body: Creds, request: Request, db: Session = Depends(get_db)):
    if not request.app.state.auth_required:
        raise HTTPException(409, "Authentication is turned off on this server.")
    email = body.email.strip().lower(); now = datetime.now(timezone.utc)
    u = db.scalar(select(UserRow).where(UserRow.email == email))
    max_fail, lock_min = int(os.getenv("AUTH_MAX_FAILURES", "5")), int(os.getenv("AUTH_LOCK_MINUTES", "15"))
    if u and u.locked_until and aware(u.locked_until) > now:
        audit(db, None, "login_failed", email, {"reason": "locked"}, actor=email, ws=u.workspace_id)
        raise HTTPException(429, f"Too many failed attempts. Try again in {lock_min} minutes or ask an admin.")
    ok = bool(u and u.is_active and verify_password(body.password, u.password_hash))
    if not u: burn_time(body.password)
    if not ok:
        if u:
            u.failed_attempts += 1
            if u.failed_attempts >= max_fail: u.locked_until = now + timedelta(minutes=lock_min); u.failed_attempts = 0
            db.commit()
        audit(db, None, "login_failed", email, {"reason": "bad credentials"}, actor=email, ws=u.workspace_id if u else None)
        raise HTTPException(401, "Incorrect email or password.")  # same message whether or not the email exists
    out = open_session(db, request, u)
    audit(db, Principal(kind="user", email=u.email, role=u.role, user_id=u.id, workspace_id=u.workspace_id or 1), "login")
    return out

@router.post("/logout")
def logout(request: Request, p: Principal = Depends(principal), db: Session = Depends(get_db)):
    tok = bearer(request)
    if tok and (s := db.scalar(select(SessionRow).where(SessionRow.token_hash == sha(tok)))):
        s.revoked = True; db.commit()
    if p.kind == "user": audit(db, p, "logout")
    return {"ok": True}

@router.get("/me")
def me(p: Principal = Depends(principal), db: Session = Depends(get_db)):
    if p.kind == "user":
        u = db.get(UserRow, p.user_id); ws = db.get(WorkspaceRow, p.workspace_id)
        return {"kind": "user", **user_dict(u), "workspace": {"id": ws.id, "name": ws.name} if ws else None}
    ws = db.get(WorkspaceRow, p.workspace_id)
    return {"kind": p.kind, "email": p.email, "name": p.email, "role": p.role, "workspace": {"id": ws.id, "name": ws.name} if ws else None}

@router.post("/change-password")
def change_password(body: ChangePw, request: Request, p: Principal = Depends(principal), db: Session = Depends(get_db)):
    if p.kind != "user": raise HTTPException(409, "Only signed-in users have passwords.")
    u = db.get(UserRow, p.user_id)
    if not verify_password(body.current_password, u.password_hash): raise HTTPException(403, "Your current password is incorrect.")
    if (msg := password_problem(body.new_password, u.email)): raise HTTPException(422, msg)
    u.password_hash = hash_password(body.new_password)
    keep = sha(bearer(request) or "")
    for s in db.scalars(select(SessionRow).where(SessionRow.user_id == u.id, SessionRow.revoked.is_(False))):
        if s.token_hash != keep: s.revoked = True   # sign out everywhere else
    db.commit(); audit(db, p, "password_changed")
    return {"ok": True}
