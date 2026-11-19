"""Production-to-regression: a real failure becomes a test with its text removed, only after a person confirms."""
import json, pathlib, shutil
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_auth import H, make_user, setup_admin
from tests.test_api import E

V1 = pathlib.Path(__file__).resolve().parents[2] / "benchmarks/scenarios/v1"
SECRET = ["alice@example.com", "Order 99812 for Alice Johnson", "card ending 4242", "refund approved for Alice"]


def world(tmp_path):
    d = tmp_path / "sc"; shutil.copytree(V1, d / "v1")
    c = TestClient(create_app("sqlite:///:memory:", d, auth_required=True)); admin = setup_admin(c)
    return c, admin, make_user(c, admin, "member"), make_user(c, admin, "viewer"), d


def failing_run(c, admin, tid="real-1"):
    ev = lambda i, t, **kw: {**E(i, t, **kw), "trace_id": tid}
    evs = [ev(0, "run_start", metadata={"task": "Help Alice Johnson with her order", "read_only": True})]
    for k in range(4):
        evs += [ev(1 + 2 * k, "tool_call", tool_name="check_status", tool_input={"customer": "alice@example.com", "note": "Order 99812 for Alice Johnson"}, metadata={"read_only": True}),
                ev(2 + 2 * k, "tool_result", tool_name="check_status", status="error", error_type="timeout", tool_output={"error": "card ending 4242"})]
    evs.append(ev(9, "run_end", metadata={"claimed_success": True, "final_response": "refund approved for Alice"}))
    r = c.post("/api/v1/traces", headers=H(admin), json={"trace_id": tid, "events": evs}); assert r.status_code == 201, r.text
    return tid


def test_the_preview_removes_all_text_but_keeps_the_shape(tmp_path):
    c, admin, member, viewer, _ = world(tmp_path); tid = failing_run(c, admin)
    pv = c.get(f"/api/v1/traces/{tid}/test-preview", headers=H(member)).json()
    blob = json.dumps(pv["events"])
    assert not any(s in blob for s in SECRET) and "Alice" not in blob and "4242" not in blob            # nothing a customer wrote survives
    calls = [e for e in pv["events"] if e["event_type"] == "tool_call"]
    assert len(calls) == 4 and len({json.dumps(e["tool_input"], sort_keys=True) for e in calls}) == 1   # "the same call four times" is still the same call four times
    assert [e["step_index"] for e in pv["events"]] == sorted(e["step_index"] for e in pv["events"]) and "repeated_failures" in pv["failure_categories"] + pv["not_preserved"]
    assert pv["kept"] and pv["removed"]


def test_a_test_needs_confirmation_permission_and_a_real_run(tmp_path):
    c, admin, member, viewer, _ = world(tmp_path); tid = failing_run(c, admin); url = f"/api/v1/traces/{tid}/to-test"
    ok = {"confirm_reviewed": True, "failure_categories": ["repeated_failures"]}
    assert c.post(url, headers=H(viewer), json=ok).status_code == 403                                  # viewers cannot add tests
    assert c.get(f"/api/v1/traces/{tid}/test-preview", headers=H(viewer)).status_code == 403
    assert c.post(url, headers=H(member), json={**ok, "confirm_reviewed": False}).status_code == 422   # nothing is saved without the review
    assert c.post(url, headers=H(member), json={**ok, "failure_categories": ["made_up"]}).status_code == 422
    assert c.post("/api/v1/traces/nope/to-test", headers=H(member), json=ok).status_code == 404


def test_the_saved_test_appears_in_your_own_tests_replays_and_is_audited(tmp_path):
    c, admin, member, viewer, d = world(tmp_path); tid = failing_run(c, admin)
    cats = c.get(f"/api/v1/traces/{tid}/test-preview", headers=H(member)).json()["failure_categories"]; assert cats                       # what the reviewer accepts
    r = c.post(f"/api/v1/traces/{tid}/to-test", headers=H(member), json={"confirm_reviewed": True, "failure_categories": cats}); assert r.status_code == 201, r.text
    sid = r.json()["id"]; saved = (d / "custom" / "1" / f"{sid}.json").read_text()
    assert not any(s in saved for s in SECRET)                                                           # and nothing leaked into the file on disk
    assert c.post(f"/api/v1/traces/{tid}/to-test", headers=H(member), json={"confirm_reviewed": True, "failure_categories": []}).status_code == 409
    groups = {g["key"]: g for g in c.get("/api/v1/tests/library", headers=H(viewer)).json()["groups"]}
    assert sid in [i for t in groups["custom"]["tests"] for i in t["scenario_ids"]]                     # kept apart from the built-in tests
    run = c.post("/api/v1/benchmarks/run", headers=H(member), json={"scenario_ids": [sid]}).json()["run_id"]
    s = c.get(f"/api/v1/benchmarks/{run}/summary", headers=H(member)).json()
    assert s["executed"] == 1 and s["passed"] == 1                                                       # the current detectors still catch the real failure
    assert any(a["action"] == "regression_test_created" for a in c.get("/api/v1/history/activity?limit=200", headers=H(admin)).json()["items"])


def test_sample_runs_cannot_become_tests_but_a_labelled_mistake_makes_the_test_fail(tmp_path):
    c, admin, member, viewer, _ = world(tmp_path)
    smp = c.get("/api/v1/agents/starter", headers=H(member)) if False else None
    from app.catalog import SAMPLE_RUNS
    r = c.post("/api/v1/agents/demo-bot/sample-run", headers=H(member), json={"sample": SAMPLE_RUNS[0]["key"]}); assert r.status_code == 201, r.text
    tid = r.json()["trace_id"]
    assert c.get(f"/api/v1/traces/{tid}/test-preview", headers=H(member)).status_code == 409          # simulated runs are not real failures
    tid2 = failing_run(c, admin, "real-2")                                                              # a reviewer who labels the wrong problem gets a test that fails, not a silent pass
    assert c.post(f"/api/v1/traces/{tid2}/to-test", headers=H(member), json={"confirm_reviewed": True, "failure_categories": ["sensitive_data_exposure"]}).status_code == 201
    run = c.post("/api/v1/benchmarks/run", headers=H(member), json={"scenario_ids": ["prod-real-2"]}).json()["run_id"]
    assert c.get(f"/api/v1/benchmarks/{run}/summary", headers=H(member)).json()["failed"] == 1
