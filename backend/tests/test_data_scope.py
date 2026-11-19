"""Part 3 and 4 of the production-readiness audit: real activity is never mixed with demo, sample or synthetic data, and benchmark figures are honest."""
import collections, shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.evaluation.metrics import compute, wilson
from app.evaluation.runner import run_benchmark
from app.evaluation.scenario import library_stats, load_scenarios, signature
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"

@pytest.fixture
def c(tmp_path):
    shutil.copytree(ROOT / "v1", tmp_path / "v1"); return TestClient(create_app("sqlite:///:memory:", tmp_path))

def ev(i, kind, **kw): return {"trace_id": "real-1", "run_id": "real-1", "event_id": f"e{i}", "agent_name": "billing-bot", "event_type": kind, "timestamp": "2026-01-01T00:00:00Z", "step_index": i, **kw}

def test_a_fresh_install_shows_no_activity_at_all(c):
    assert c.get("/api/v1/traces").json()["total"] == 0 and c.get("/api/v1/agents").json()["items"] == [] and c.get("/api/v1/findings").json()["total"] == 0 and c.get("/api/v1/approvals").json()["total"] == 0
    live = c.get("/api/v1/metrics/overview").json()["live"]; assert live["total_runs"] == 0 and live["recent_incidents"] == []

def test_demo_sample_and_starter_runs_never_count_as_production(c):
    c.post("/api/v1/demo/seed"); c.post("/api/v1/agents/orders-agent/sample-run", json={"sample": "no_approval"})
    c.post("/api/v1/traces", json={"trace_id": "starter-x", "events": [ev(0, "run_start", metadata={"starter": True}) | {"trace_id": "starter-x", "run_id": "starter-x"}]})
    assert c.get("/api/v1/traces").json()["total"] == 0 and c.get("/api/v1/agents").json()["items"] == [] and c.get("/api/v1/findings").json()["total"] == 0
    assert c.get("/api/v1/metrics/overview").json()["live"]["total_runs"] == 0 and c.get("/api/v1/metrics/trends").json() == c.get("/api/v1/metrics/trends?data=production").json()
    syn = c.get("/api/v1/traces?data=synthetic&limit=100").json(); assert syn["total"] > 20 and {t["origin"] if "origin" in t else None for t in syn["items"]} <= {None, "demo", "sample", "starter"}
    allv = c.get("/api/v1/traces?data=all").json()["total"]; assert allv == syn["total"]
    ag = {a["name"]: a for a in c.get("/api/v1/agents?data=synthetic").json()["items"]}; assert ag["orders-agent"]["origin"] == "sample" and ag["orders-agent"]["test_runs"] == 1

def test_real_activity_is_counted_and_a_real_run_makes_the_agent_real(c):
    c.post("/api/v1/agents/billing-bot/sample-run", json={"sample": "normal"})
    assert c.get("/api/v1/agents").json()["items"] == []
    assert c.post("/api/v1/traces", json={"trace_id": "real-1", "events": [ev(0, "run_start"), ev(1, "run_end")]}).status_code in (200, 201, 202)
    a = c.get("/api/v1/agents").json()["items"]; assert [x["name"] for x in a] == ["billing-bot"] and a[0]["runs"] == 1 and a[0]["test_runs"] == 1 and a[0]["origin"] == "production"
    assert c.get("/api/v1/metrics/overview").json()["live"]["total_runs"] == 1 and c.get("/api/v1/traces").json()["total"] == 1

def test_removing_demo_data_leaves_real_data_alone(c):
    c.post("/api/v1/demo/seed"); c.post("/api/v1/traces", json={"trace_id": "real-1", "events": [ev(0, "run_start"), ev(1, "run_end")]})
    r = c.delete("/api/v1/demo-data").json(); assert r["deleted"] > 20
    assert c.get("/api/v1/traces?data=all").json()["total"] == 1 and [a["name"] for a in c.get("/api/v1/agents?data=all").json()["items"]] == ["billing-bot"]

def test_the_scenario_library_has_no_repeated_tests_and_no_split_leakage():
    sc = load_scenarios(ROOT); sigs = [signature(s) for s in sc]
    assert len(sigs) == len(set(sigs)), "the same test appears twice"
    seen = collections.defaultdict(set)
    for s in sc: seen[signature(s)].add(s.split)
    assert all(len(v) == 1 for v in seen.values())
    st = library_stats(ROOT); assert st["builtin_files"] > st["builtin_unique"] == len(sc) and st["repeats_dropped"] + st["dropped_for_split_leakage"] == st["builtin_files"] - st["builtin_unique"]
    api = TestClient(create_app("sqlite:///:memory:", ROOT.parent / "scenarios")); items = api.get("/api/v1/scenarios").json()["items"]
    assert len({i["id"] for i in items}) == len(items)

def test_zero_denominators_are_not_available_never_zero_or_hundred_percent():
    assert wilson(0, 0) is None and wilson(5, 10)[0] < 0.5 < wilson(5, 10)[1] and wilson(10, 10)[1] == 1.0 and wilson(10, 10)[0] < 1.0     # a perfect score still has an interval
    quiet = [r for r in run_benchmark(load_scenarios(ROOT), 0)["results"] if not r["true"] and not r["pred"]][:5]     # runs with nothing to catch and nothing flagged
    assert quiet
    m = compute(quiet, 0)
    assert m["detection"]["micro_recall"] is None and m["detection"]["micro_precision"] is None and m["denominators"]["recall"] == 0       # nothing to catch: recall is N/A, not 100%
    assert m["localization"]["accuracy"] is None and m["recovery"]["recovery_success_rate"] is None and m["ci95_wilson"]["micro_recall"] is None
    assert any(w["scope"] == "overall" for w in m["sample_warnings"])

def test_benchmark_metrics_are_recomputable_from_the_stored_per_scenario_results():
    r = run_benchmark(load_scenarios(ROOT), 0, None, "9.9"); res = r["results"]; d = r["metrics"]["detection"]
    tp = sum(len(set(x["pred"]) & set(x["true"])) for x in res); fp = sum(len(set(x["pred"]) - set(x["true"])) for x in res); fn = sum(len(set(x["true"]) - set(x["pred"])) for x in res)
    assert d["micro_precision"] == pytest.approx(tp / (tp + fp)) and d["micro_recall"] == pytest.approx(tp / (tp + fn))
    assert r["metrics"]["denominators"]["precision"] == tp + fp and r["metrics"]["denominators"]["recall"] == tp + fn
    assert r["dataset"]["n_scenarios"] == len(res) == r["dataset"]["n_distinct"] and r["versions"]["agentguard"] == "9.9" and r["metrics"]["outcomes"]["baseline_is_constructed"] is True
    assert "SYNTHETIC" in r["label"] and r["dataset"]["kind"] == "synthetic"


def test_home_suggestions_follow_the_recorded_data(c):
    keys = lambda: [s["key"] for s in c.get("/api/v1/metrics/overview").json()["suggestions"]]
    assert keys() == ["connect_first_agent"] and c.get("/api/v1/metrics/overview").json()["agents"] == {"registered": 0, "connected": 0}
    c.post("/api/v1/agents", json={"name": "billing-bot"}); assert keys() == ["send_first_task", "run_reliability_test"]
    c.post("/api/v1/traces", json={"trace_id": "real-1", "events": [ev(0, "run_start"), ev(1, "run_end")]})
    assert c.get("/api/v1/metrics/overview").json()["agents"] == {"registered": 1, "connected": 1} and keys() == ["create_safety_rule", "run_reliability_test"]
    c.post("/api/v1/demo/seed"); assert "review_problems" not in keys()                       # demo problems are not advice about your agents
    assert c.get("/api/v1/metrics/overview?data=synthetic").json()["suggestions"] == []
