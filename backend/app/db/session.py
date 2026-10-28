import os
from sqlalchemy import create_engine
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
    Base.metadata.create_all(eng)  # Alembic manages prod; this keeps dev/tests zero-config
    return eng

def make_session_factory(engine):
    return sessionmaker(engine, expire_on_commit=False)
