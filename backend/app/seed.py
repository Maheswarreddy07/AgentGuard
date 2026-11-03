"""Seed demo traces (SYNTHETIC): python -m app.seed"""
from pathlib import Path
from app.db.session import make_engine, make_session_factory
from app.services.demo import seed_demo

def main():
    root = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"
    with make_session_factory(make_engine())() as db:
        print(f"seeded {seed_demo(db, 1, root)} new synthetic traces")

if __name__ == "__main__":
    main()
