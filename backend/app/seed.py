"""Seed demo traces (SYNTHETIC) from benchmark scenarios: python -m app.seed"""
from pathlib import Path
from app.db.session import make_engine, make_session_factory
from app.evaluation.runner import build_events
from app.evaluation.scenario import load_scenarios
from app.services.ingest import ingest

def main():
    root = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"
    scs = load_scenarios(root)
    pick = [s for s in scs if s.id.endswith(("-000", "-001"))]
    with make_session_factory(make_engine())() as db:
        for s in pick:
            ingest(db, s.id, build_events(s))
    print(f"seeded {len(pick)} synthetic traces")

if __name__ == "__main__":
    main()
