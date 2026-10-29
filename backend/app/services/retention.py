import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import TraceRow

def purge_older_than(db: Session, days: int) -> int:
    if days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    old = db.scalars(select(TraceRow)).all()
    n = 0
    for t in old:
        created = t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=timezone.utc)
        if created < cutoff:
            db.delete(t); n += 1  # events cascade
    db.commit()
    return n

if __name__ == "__main__":
    from app.db.session import make_engine, make_session_factory
    with make_session_factory(make_engine())() as s:
        print("purged", purge_older_than(s, int(os.getenv("RETENTION_DAYS", "0"))))
