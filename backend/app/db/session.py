import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db.models import Base

def make_engine(url: str | None = None):
    url = url or os.getenv("DATABASE_URL", "sqlite:///./agentguard.db")
    kw = {}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kw["poolclass"] = StaticPool
    eng = create_engine(url, **kw)
    if os.getenv("AUTO_CREATE_TABLES", "1") == "1":  # prod sets 0 and uses `alembic upgrade head`
        Base.metadata.create_all(eng)
        _add_missing_columns(eng)
    return eng

def _add_missing_columns(eng) -> None:
    """Dev convenience: upgrade an older local DB in place. Production uses Alembic."""
    insp = inspect(eng)
    for name, table in Base.metadata.tables.items():
        if not insp.has_table(name):
            continue
        have = {c["name"] for c in insp.get_columns(name)}
        for col in table.columns:
            if col.name not in have:
                with eng.begin() as conn:
                    conn.execute(text(f'ALTER TABLE {name} ADD COLUMN {col.name} {col.type.compile(eng.dialect)}'))

def make_session_factory(engine):
    return sessionmaker(engine, expire_on_commit=False)
