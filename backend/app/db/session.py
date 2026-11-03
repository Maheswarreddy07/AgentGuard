import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db.models import Base
from app.db.upgrade import add_missing_columns, backfill_workspace_ids, upgrade_to_workspaces

def make_engine(url: str | None = None):
    url = url or os.getenv("DATABASE_URL", "sqlite:///./agentguard.db")
    kw = {}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kw["poolclass"] = StaticPool
    eng = create_engine(url, **kw)
    if os.getenv("AUTO_CREATE_TABLES", "1") == "1":  # prod sets 0 and uses `alembic upgrade head`
        with eng.begin() as conn:
            upgrade_to_workspaces(conn)       # pre-workspace databases: rebuild traces/events/settings, keeping the data
        Base.metadata.create_all(eng)
        with eng.begin() as conn:
            add_missing_columns(conn)
            backfill_workspace_ids(conn)
    return eng

def make_session_factory(engine):
    return sessionmaker(engine, expire_on_commit=False)
