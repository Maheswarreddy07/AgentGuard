import shutil, sqlite3
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.db.session import make_engine
from tests.test_api import E

ROOT = Path(__file__).resolve().parents[2] / "benchmarks/scenarios"

@pytest.fixture
def c(tmp_path):
    shutil.copytree(ROOT / "v1", tmp_path / "v1")
    return TestClient(create_app("sqlite:///:memory:", tmp_path))

def test_demo_seed_idempotent_and_summaries(c):
    assert c.post("/api/v1/demo/seed").json()["seeded"] == 28 and c.post("/api/v1/demo/seed").json()["seeded"] == 0
    f = c.get("/api/v1/traces/facets").json()
    assert f["total"] == 28 and f["flagged"] + f["clean"] == 28 and "critical" in f["severity"]

def test_trace_filters_and_sort(c):
    c.post("/api/v1/demo/seed")
    flagged = c.get("/api/v1/traces?status=flagged&limit=100").json()
    assert all(t["status"] == "flagged" and t["headline"] for t in flagged["items"])
    crit = c.get("/api/v1/traces?severity=critical&sort=severity").json()["items"]
    assert crit and all(t["max_severity"] == "critical" for t in crit)
    assert all("unauthorized_action" in t["categories"] for t in c.get("/api/v1/traces?category=unauthorized_action").json()["items"])
    assert c.get("/api/v1/traces?q=unsupported").json()["total"] == 2
    assert c.get("/api/v1/traces?severity=bogus").status_code == 422

def test_overview_incidents_and_error_shape(c):
    c.post("/api/v1/demo/seed")
    live = c.get("/api/v1/metrics/overview").json()["live"]
    assert live["total_runs"] == 28 and live["recent_incidents"] and live["by_severity"]
    err = c.get("/api/v1/traces/nope").json()["error"]
    assert err["code"] == "http_error"
    assert c.post("/api/v1/traces", json={"trace_id": "x", "events": [{"bad": 1}]}).json()["error"]["code"] == "validation_error"

def test_analysis_is_enriched_and_plan_does_not_execute(c):
    c.post("/api/v1/demo/seed")
    a = c.get("/api/v1/traces/unauthorized-000/analysis").json()
    f = a["findings"][0]
    assert f["label"] == "Action without approval" and f["why"] and f["proof"] == "rule" and a["summary"]["max_severity"] == "critical"
    p = c.get("/api/v1/traces/unauthorized-000/recovery-plan").json()
    assert p["action"] == "escalate" and p["executes_anything"] is False
    assert c.get("/api/v1/traces/unauthorized-000").json()["events"][-1]["event_type"] != "recovery_attempt"  # plan didn't write

def test_meta_covers_every_category(c):
    from app.schemas.findings import Category
    m = c.get("/api/v1/meta").json()
    assert {x.value for x in Category} <= set(m["categories"]) and "precision" in m["metrics"]

def test_compare_and_mistakes_and_scenario_detail(c):
    r1 = c.post("/api/v1/benchmarks/run", json={"seed": 0}).json()["run_id"]
    r2 = c.post("/api/v1/benchmarks/run", json={"scenario_ids": ["success-000", "invalid_args-000"]}).json()["run_id"]
    d = c.get(f"/api/v1/benchmark-compare?a={r1}&b={r2}").json()
    assert {x["metric"] for x in d["rows"]} >= {"precision", "safe_outcome"}
    assert c.get(f"/api/v1/benchmarks/{r1}/results?only=mistakes").json()["results"] == []  # v1 only: no mistakes
    m = c.get(f"/api/v1/benchmarks/{r1}").json()["metrics"]
    assert "per_scenario_category" in m and m["per_scenario_category"]["success"]["n"] == 20
    s = c.get("/api/v1/scenarios/retry_loop-000").json()
    assert s["labels"]["expected_action"] == "stop" and len(s["events"]) > 3
    assert c.get("/api/v1/scenarios/zzz").status_code == 404

def test_old_database_is_upgraded_in_place(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("create table traces (trace_id varchar(128) primary key, agent_name varchar(128) not null, created_at datetime)")
    con.execute("insert into traces values ('legacy','a','2026-01-01 00:00:00')"); con.commit(); con.close()
    c = TestClient(create_app(f"sqlite:///{db}", tmp_path))  # adds columns + backfills
    assert c.get("/api/v1/traces").status_code == 200
