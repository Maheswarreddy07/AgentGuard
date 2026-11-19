from pathlib import Path
from sqlalchemy.orm import Session
from app.evaluation.runner import build_events
from app.evaluation.scenario import load_scenarios
from app.services.ingest import ingest

def seed_demo(db: Session, ws: int, scen_dir: Path) -> int:
    """Load a few SYNTHETIC traces (2 per scenario family), marked origin=demo so they never count as production activity. Idempotent."""
    n, taken = 0, {}
    for s in load_scenarios(scen_dir):                      # distinct tests only; the first two of every family (by id) are shown
        if taken.get(s.category, 0) < 2:
            taken[s.category] = taken.get(s.category, 0) + 1
            n += ingest(db, ws, s.id, build_events(s), origin="demo")["accepted"] > 0
    return n
