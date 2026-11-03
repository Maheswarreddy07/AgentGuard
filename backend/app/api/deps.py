from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.auth import sha
from app.db.models import ApiKeyRow, AuditRow, SessionRow, UserRow

RANK = {"viewer": 1, "member": 2, "admin": 3}

class Principal(BaseModel):
    kind: str            # user | apikey | open (auth disabled)
    email: str
    role: str            # viewer | member | admin | agent (API keys)
    workspace_id: int = 1
    user_id: int | None = None
    name: str | None = None

def get_db(request: Request):
    with request.app.state.factory() as s:
        yield s

def aware(d: datetime) -> datetime: return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

def bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None

def principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    if not request.app.state.auth_required:
        return Principal(kind="open", email="anonymous", role="admin", workspace_id=1)
    tok = bearer(request)
    if not tok:
        raise HTTPException(401, "Please sign in.")
    now = datetime.now(timezone.utc)
    if tok.startswith("ag_"):
        k = db.scalar(select(ApiKeyRow).where(ApiKeyRow.key_hash == sha(tok)))
        if not k or k.revoked_at:
            raise HTTPException(401, "This API key is invalid or has been revoked.")
        k.last_used_at = now; db.commit()
        return Principal(kind="apikey", email=f"key:{k.name}", role="agent", workspace_id=k.workspace_id or 1)
    s = db.scalar(select(SessionRow).where(SessionRow.token_hash == sha(tok)))
    if not s or s.revoked or aware(s.expires_at) < now:
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    u = db.get(UserRow, s.user_id)
    if not u or not u.is_active:
        raise HTTPException(401, "This account is disabled.")
    return Principal(kind="user", email=u.email, role=u.role, workspace_id=u.workspace_id or 1, user_id=u.id, name=u.name)

def require(min_role: str):
    def dep(p: Principal = Depends(principal)) -> Principal:
        if p.role == "agent" or RANK[p.role] < RANK[min_role]:
            raise HTTPException(403, f"You need the “{min_role}” role or higher to do this.")
        return p
    return dep

def require_agent(p: Principal = Depends(principal)) -> Principal:
    """Endpoints a running agent needs: sending events, asking for a runtime decision, polling an approval, reporting a recovery."""
    if p.role == "agent" or RANK[p.role] >= RANK["member"]:
        return p
    raise HTTPException(403, "This needs an agent API key or the “member” role.")
require_ingest = require_agent

def audit(db: Session, p: Principal | None, action: str, target: str | None = None, detail: dict | None = None, kind: str | None = None, actor: str | None = None, ws: int | None = None) -> None:
    from app.catalog import SECURITY_ACTIONS
    db.add(AuditRow(workspace_id=ws if ws is not None else (p.workspace_id if p else None), kind=kind or ("security" if action in SECURITY_ACTIONS else "activity"),
                    actor=actor or (p.email if p else "unknown"), actor_role=p.role if p else None, action=action, target=target, detail=detail or {}))
    db.commit()
