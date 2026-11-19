import pytest
from fastapi.testclient import TestClient
from app.evaluation.metrics import compute, prf
from app.main import create_app
from tests.test_api import E

from app.evaluation.scenario import load_scenarios as _load
N_V1 = len(_load(__import__('pathlib').Path(__file__).resolve().parents[2] / 'benchmarks/scenarios/v1'))     # distinct tests: repeated copies are not counted twice

def test_prf_and_empty():
    assert prf(0, 0, 0) == (None, None, None)
    p, r, f = prf(3, 1, 1); assert (p, r) == (0.75, 0.75) and abs(f - 0.75) < 1e-9

def R(true, pred, **kw):
    base = dict(category="x", true=true, pred=pred, true_step=None, pred_step=None, action="none", expected_action="none", latency_ms=1.0,
                outcome={"attempted": False, "recovered": False}, baseline_success=not true, baseline_safe=not true, protected_success=not true, protected_safe=not true)
    return {**base, **kw}

def test_metric_denominators():
    m = compute([R(["a"], ["a"]), R(["a"], []), R([], ["a"]), R([], [])])
    d = m["detection"]
    assert m["per_category"]["a"]["tp"] == 1 and m["per_category"]["a"]["fn"] == 1 and m["per_category"]["a"]["fp"] == 1
    assert d["false_positive_rate"] == 0.5 and m["n_clean"] == 2

@pytest.fixture
def c(tmp_path):
    import shutil, pathlib
    d = tmp_path / "sc"; shutil.copytree(pathlib.Path(__file__).resolve().parents[2] / "benchmarks/scenarios/v1", d / "v1")
    return TestClient(create_app("sqlite:///:memory:", d))

def test_full_journey(c):
    evs = [E(0, "run_start"), E(1, "tool_call", tool_name="lookup", metadata={"read_only": True}),
           E(2, "tool_result", tool_name="lookup", status="error", error_type="timeout"), E(3, "run_end", metadata={"claimed_success": False})]
    assert c.post("/api/v1/traces", json={"trace_id": "t1", "events": evs}).status_code == 201
    a = c.get("/api/v1/traces/t1/analysis").json(); assert a["findings"][0]["category"] == "tool_execution_failure"
    r = c.post("/api/v1/traces/t1/recover", json={"sim": {"transient_fail_count": 1}}).json()
    assert r["decision"]["action"] == "retry" and r["outcome"]["recovered"] is True and r["simulated"] is True
    assert c.get("/api/v1/traces/t1").json()["events"][-1]["event_type"] == "recovery_attempt"
    run = c.post("/api/v1/benchmarks/run", json={"seed": 0}).json()["run_id"]
    g = c.get(f"/api/v1/benchmarks/{run}").json(); assert g["status"] == "completed" and g["metrics"]["n_scenarios"] == N_V1
    assert len(c.get(f"/api/v1/benchmarks/{run}/results").json()["results"]) == N_V1
    assert c.get("/api/v1/metrics/overview").json()["benchmark"]["source"] == "synthetic"

def test_unknown_scenarios_fail_honestly(c):
    run = c.post("/api/v1/benchmarks/run", json={"scenario_ids": ["nope"]}).json()["run_id"]
    assert c.get(f"/api/v1/benchmarks/{run}").json()["status"] == "failed"
    assert c.get(f"/api/v1/benchmarks/{run}/results").status_code == 409

def test_consequential_never_retried(c):
    evs = [E(0, "run_start"), E(1, "tool_call", tool_name="pay", metadata={"read_only": False, "consequential": True}),
           E(2, "tool_result", tool_name="pay", status="error", error_type="timeout"), E(3, "run_end")]
    c.post("/api/v1/traces", json={"trace_id": "t1", "events": evs})
    assert c.post("/api/v1/traces/t1/recover", json={}).json()["decision"]["action"] == "escalate"

def test_add_scenario_validation(c):
    bad = {"id": "x", "category": "c", "description": "d", "task": "t", "events": [{"bogus": 1}], "labels": {}}
    assert c.post("/api/v1/scenarios", json=bad).status_code == 422
    ok = {**bad, "events": [{"event_id": "e0", "step_index": 0, "event_type": "run_start"}]}
    assert c.post("/api/v1/scenarios", json=ok).status_code == 201 and c.post("/api/v1/scenarios", json=ok).status_code == 409
