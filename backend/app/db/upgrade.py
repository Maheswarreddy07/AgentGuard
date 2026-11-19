"""One-time data-preserving upgrade for databases created before workspaces existed (tables whose primary keys changed).
Used by the dev auto-upgrade and by Alembic migration 0004, so both paths behave identically."""
import json
from datetime import datetime, timezone
from sqlalchemy import DateTime, JSON, insert, inspect, text
from app.db import models as m

def _rows(conn, table):
    return [dict(r._mapping) for r in conn.execute(text(f"select * from {table}"))] if inspect(conn).has_table(table) else []

def _coerce(table, row: dict) -> dict:
    """Raw SELECTs return dates as text (SQLite) and JSON as text; convert to the types the new tables expect."""
    out = {}
    for c in table.columns:
        if c.name not in row: continue
        v = row[c.name]
        if v is not None and isinstance(c.type, DateTime) and isinstance(v, str): v = datetime.fromisoformat(v)
        if v is not None and isinstance(c.type, JSON): v = _j(v)
        out[c.name] = v
    for c in table.columns:   # old rows predate newer NOT NULL columns: apply the column's own default
        if c.name not in out and c.default is not None and not c.primary_key:
            d = c.default.arg
            out[c.name] = d(None) if callable(d) else d
    return out

def _j(v):
    return json.loads(v) if isinstance(v, str) else v

def ensure_default_workspace(conn) -> int:
    row = conn.execute(text("select id from workspaces order by id limit 1")).first()
    if row: return row[0]
    conn.execute(insert(m.WorkspaceRow.__table__).values(name="Default workspace", created_at=datetime.now(timezone.utc)))
    return conn.execute(text("select id from workspaces order by id limit 1")).first()[0]

def upgrade_to_workspaces(conn) -> bool:
    insp = inspect(conn)
    if not insp.has_table("traces") or "workspace_id" in {c["name"] for c in insp.get_columns("traces")}:
        return False
    traces, events, settings = _rows(conn, "traces"), _rows(conn, "events"), _rows(conn, "app_settings")
    for t in ("events", "traces", "app_settings"):
        if insp.has_table(t): conn.execute(text(f"drop table {t}"))
    m.Base.metadata.create_all(conn, tables=[m.WorkspaceRow.__table__, m.TraceRow.__table__, m.EventRow.__table__, m.SettingRow.__table__])
    ws = ensure_default_workspace(conn)
    for t in traces: conn.execute(insert(m.TraceRow.__table__).values(**_coerce(m.TraceRow.__table__, t), workspace_id=ws))
    for e in events: conn.execute(insert(m.EventRow.__table__).values(**_coerce(m.EventRow.__table__, {k: v for k, v in e.items() if k != "id"}), workspace_id=ws))
    for s in settings: conn.execute(insert(m.SettingRow.__table__).values(**_coerce(m.SettingRow.__table__, s), workspace_id=ws))
    return True

def backfill_workspace_ids(conn) -> None:
    ws = ensure_default_workspace(conn)
    for t in ("users", "api_keys", "audit_log", "benchmark_runs"):
        if inspect(conn).has_table(t) and "workspace_id" in {c["name"] for c in inspect(conn).get_columns(t)}:
            conn.execute(text(f"update {t} set workspace_id = :w where workspace_id is null"), {"w": ws})


def backfill_origin(conn) -> None:
    """Old rows have no origin. Runs that the demo loader, the sample runner or the starter file created are marked so they stop counting as real activity."""
    insp = inspect(conn)
    for table in ("traces", "agents"):
        if insp.has_table(table) and "origin" in {c["name"] for c in insp.get_columns(table)}:
            conn.execute(text(f"UPDATE {table} SET origin = 'production' WHERE origin IS NULL"))
    if insp.has_table("traces") and "origin" in {c["name"] for c in insp.get_columns("traces")}:
        conn.execute(text("UPDATE traces SET origin = 'sample' WHERE origin = 'production' AND trace_id LIKE 'sample-%'"))
        conn.execute(text("UPDATE traces SET origin = 'starter' WHERE origin = 'production' AND trace_id LIKE 'starter-%'"))

def add_missing_columns(conn) -> None:
    """Dev/migration convenience: add columns that exist in the models but not yet in the database (all nullable)."""
    insp = inspect(conn)
    for name, table in m.Base.metadata.tables.items():
        if not insp.has_table(name): continue
        have = {c["name"] for c in insp.get_columns(name)}
        for col in table.columns:
            if col.name not in have:
                conn.execute(text(f'ALTER TABLE {name} ADD COLUMN {col.name} {col.type.compile(conn.dialect)}'))
