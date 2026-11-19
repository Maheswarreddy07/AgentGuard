import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import TraceRow
from app.services.deletion import delete_traces

def purge_older_than(db: Session, days: int, ws: int | None = None) -> int:
    if days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    q = select(TraceRow) if ws is None else select(TraceRow).where(TraceRow.workspace_id == ws)
    doomed: dict[int, list[str]] = {}
    for t in db.scalars(q).all():
        created = t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=timezone.utc)
        if created < cutoff: doomed.setdefault(t.workspace_id, []).append(t.trace_id)
    n = sum(delete_traces(db, w, ids) for w, ids in doomed.items())
    db.commit()
    return n

if __name__ == "__main__":
    from app.db.session import make_engine, make_session_factory
    with make_session_factory(make_engine())() as s:
        print("purged", purge_older_than(s, int(os.getenv("RETENTION_DAYS", "0"))))
