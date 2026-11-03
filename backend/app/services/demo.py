from pathlib import Path
from sqlalchemy.orm import Session
from app.evaluation.runner import build_events
from app.evaluation.scenario import load_scenarios
from app.services.ingest import ingest

def seed_demo(db: Session, ws: int, scen_dir: Path) -> int:
    """Load a few SYNTHETIC traces (2 per scenario family). Idempotent."""
    n = 0
    for s in load_scenarios(scen_dir):
        if s.id.endswith(("-000", "-001")):
            n += ingest(db, ws, s.id, build_events(s))["accepted"] > 0
    return n
