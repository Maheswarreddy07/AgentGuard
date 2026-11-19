"""What the database looks like and a way to take a copy of it, for the admin console."""
import os, sqlite3, tempfile
from pathlib import Path
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session
from app.db import models as M

COUNTED = [("agents", M.AgentRow), ("runs", M.TraceRow), ("events", M.EventRow), ("findings", M.FindingRow), ("policies", M.PolicyRow), ("approvals", M.ApprovalRow), ("users", M.UserRow), ("api_keys", M.ApiKeyRow), ("audit_entries", M.AuditRow)]

def info(db: Session, ws: int) -> dict:
    engine = db.get_bind(); kind = engine.dialect.name
    counts = {}
    for key, model in COUNTED:
        q = select(func.count()).select_from(model)
        if hasattr(model, "workspace_id") and model is not M.UserRow: q = q.where(model.workspace_id == ws)
        counts[key] = db.scalar(q) or 0
    version = None
    if "alembic_version" in inspect(engine).get_table_names():
        version = db.execute(text("select version_num from alembic_version")).scalar()
    size = None
    path = engine.url.database if kind == "sqlite" else None
    if path and path != ":memory:" and Path(path).exists(): size = Path(path).stat().st_size
    return {"engine": kind, "schema_version": version, "size_bytes": size, "counts": counts, "backup_supported": bool(path) and path != ":memory:", "retention_days_env": os.getenv("RETENTION_DAYS")}

def sqlite_backup(db: Session) -> str:
    """A consistent copy of a live SQLite database (uses SQLite's own backup, safe while the app is running)."""
    src_path = db.get_bind().url.database
    fd, out = tempfile.mkstemp(suffix=".db"); os.close(fd)
    with sqlite3.connect(src_path) as src, sqlite3.connect(out) as dst: src.backup(dst)
    return out
