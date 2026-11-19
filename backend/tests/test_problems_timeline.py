"""Steps 8 to 10: agents with connection status, a readable activity timeline, and problems that answer the five questions."""
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_auth import H, make_user, setup_admin

ROOT = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"

@pytest.fixture
def c(tmp_path):
    shutil.copytree(ROOT / "v1", tmp_path / "v1"); return TestClient(create_app("sqlite:///:memory:", tmp_path, auth_required=True))

def failing_run(c, tok, tid="real-1", agent="billing-bot", n=4):
    """A real run in which the same tool fails over and over: AgentGuard should flag a retry loop."""
    ev = lambda i, kind, **kw: {"trace_id": tid, "run_id": tid, "event_id": f"e{i}", "agent_name": agent, "event_type": kind, "timestamp": f"2026-01-01T00:00:{i:02d}Z", "step_index": i, **kw}
    evs = [ev(0, "run_start", metadata={"sdk": "agentguard-python"})]
    for k in range(n):
        evs += [ev(1 + 2 * k, "tool_call", tool_name="check_status", tool_input={"id": 7}), ev(2 + 2 * k, "tool_result", tool_name="check_status", status="error", tool_output={"error": "timeout"})]
    evs.append(ev(2 * n + 1, "run_end", status="error"))
    assert c.post("/api/v1/traces", headers=H(tok), json={"trace_id": tid, "events": evs}).status_code in (200, 201, 202)

def test_problems_answer_the_five_questions_and_group_by_urgency(c):
    admin = setup_admin(c); failing_run(c, admin)
    r = c.get("/api/v1/problems", headers=H(admin)).json(); assert r["total"] >= 1 and set(r["counts"]) == {"critical", "warning", "resolved"} and sum(r["counts"].values()) == r["total"]
    p = r["items"][0]
    assert p["what_happened"] and p["why_it_matters"] and p["agent"] == "billing-bot" and p["what_agentguard_did"]["key"] in {"blocked", "approval", "recovery", "warned", "recorded"} and p["next_steps"]
    assert p["group"] in ("critical", "warning") and isinstance(p["confirmed"], bool) and p["evidence"] is not None
    assert all(i["group"] == "critical" for i in c.get("/api/v1/problems?group=critical", headers=H(admin)).json()["items"])
    assert c.get("/api/v1/problems?group=nonsense", headers=H(admin)).status_code == 422

def test_resolving_a_problem_needs_a_member_moves_it_and_survives_reanalysis(c):
    admin = setup_admin(c); member, viewer = make_user(c, admin, "member"), make_user(c, admin, "viewer"); failing_run(c, admin)
    fid = c.get("/api/v1/problems", headers=H(admin)).json()["items"][0]["id"]
    assert c.post(f"/api/v1/problems/{fid}/resolve", headers=H(viewer), json={}).status_code == 403
    assert c.post(f"/api/v1/problems/{fid}/resolve", headers=H(member), json={"note": "fixed the tool"}).json() == {"resolved": True}
    done = c.get("/api/v1/problems?group=resolved", headers=H(admin)).json(); assert done["total"] == 1 and done["items"][0]["resolved_by"] == "member@x.io" and done["items"][0]["resolution_note"] == "fixed the tool"
    failing_run(c, admin)                                                                   # the same run arrives again and is analysed again: the same problem stays resolved
    assert [i["id"] for i in c.get("/api/v1/problems?group=resolved", headers=H(admin)).json()["items"]] == [fid]
    assert c.post(f"/api/v1/problems/{fid}/reopen", headers=H(member)).json() == {"resolved": False} and c.get("/api/v1/problems?group=resolved", headers=H(admin)).json()["counts"]["resolved"] == 0
    assert c.post("/api/v1/problems/nope/resolve", headers=H(member), json={}).status_code == 404
    assert {"problem_resolved", "problem_reopened"} <= {e["action"] for e in c.get("/api/v1/history/activity?limit=100", headers=H(admin)).json()["items"]}

def test_problems_are_isolated_from_demo_and_sample_runs(c):
    admin = setup_admin(c); c.post("/api/v1/demo/seed", headers=H(admin)); c.post("/api/v1/agents/x/sample-run", headers=H(admin), json={"sample": "stuck"})
    assert c.get("/api/v1/problems", headers=H(admin)).json() == {"counts": {"critical": 0, "warning": 0, "resolved": 0}, "total": 0, "items": []}
    assert c.get("/api/v1/problems?data=synthetic", headers=H(admin)).json()["total"] > 0

def test_timeline_lists_what_happened_newest_first_and_never_invents(c):
    admin = setup_admin(c); assert c.get("/api/v1/activity/timeline", headers=H(admin)).json()["items"] == []
    failing_run(c, admin); t = c.get("/api/v1/activity/timeline", headers=H(admin)).json(); kinds = [i["kind"] for i in t["items"]]
    assert "task_started" in kinds and "problem_detected" in kinds and [i["ts"] for i in t["items"]] == sorted((i["ts"] for i in t["items"]), reverse=True)
    assert all(i["agent"] == "billing-bot" and i["trace_id"] == "real-1" for i in t["items"])
    c.post("/api/v1/agents/y/sample-run", headers=H(admin), json={"sample": "no_approval"})
    assert {i["agent"] for i in c.get("/api/v1/activity/timeline", headers=H(admin)).json()["items"]} == {"billing-bot"}                # samples stay out
    syn = c.get("/api/v1/activity/timeline?data=synthetic", headers=H(admin)).json()["items"]; assert syn and {i["agent"] for i in syn} == {"y"}
    assert c.get("/api/v1/activity/timeline?runs=1", headers=H(admin)).json()["runs"] == 1

def test_agents_show_connection_integration_recent_activity_and_open_problems(c):
    admin = setup_admin(c); assert c.post("/api/v1/agents", headers=H(admin), json={"name": "billing-bot"}).status_code == 201
    a = lambda: {x["name"]: x for x in c.get("/api/v1/agents", headers=H(admin)).json()["items"]}["billing-bot"]
    assert a()["connection"] == "waiting" and a()["integration"] is None and a()["recent_activity"] == [] and a()["open_problems"] == 0
    c.post("/api/v1/agents/billing-bot/sample-run", headers=H(admin), json={"sample": "normal"}); assert a()["connection"] == "test_only" and a()["runs"] == 0 and a()["test_runs"] == 1
    failing_run(c, admin); x = a(); assert x["connection"] == "connected" and x["integration"] == "sdk" and x["runs"] == 1 and x["open_problems"] >= 1 and x["recent_activity"][0]["trace_id"] == "real-1"
    fid = c.get("/api/v1/problems", headers=H(admin)).json()["items"][0]["id"]; before = a()["open_problems"]
    c.post(f"/api/v1/problems/{fid}/resolve", headers=H(admin), json={}); assert a()["open_problems"] == before - 1


def test_problems_use_plain_language_and_keep_the_detector_text_for_technical_view(c):
    admin = setup_admin(c); failing_run(c, admin)
    items = c.get("/api/v1/problems", headers=H(admin)).json()["items"]; assert items
    for p in items:
        assert p["title"] and p["what_happened"] and p["what_happened"] != p["technical_description"]       # plain sentence up front
        assert p["technical_description"]                                                                    # the detector's own wording is kept for the Technical details
        assert not any(w in p["what_happened"].lower() for w in ("tool call", "invalid tool", "schema"))      # no engineering jargon in the main sentence


def test_the_same_problem_repeated_in_one_run_is_one_incident_and_resolving_it_resolves_all(c):
    admin = setup_admin(c); failing_run(c, admin, n=4)
    d = c.get("/api/v1/problems", headers=H(admin)).json()
    keys = [(p["trace_id"], p["category"], p["rule"]) for p in d["items"]]
    assert len(keys) == len(set(keys)) == d["total"] == sum(d["counts"].values())          # no duplicate records for one incident
    tf = next(p for p in d["items"] if p["category"] == "tool_execution_failure"); assert tf["occurrences"] == 4
    assert c.post(f"/api/v1/problems/{tf['id']}/resolve", headers=H(admin), json={"note": "fixed upstream"}).status_code == 200
    d2 = c.get("/api/v1/problems", headers=H(admin)).json()
    assert next(p for p in d2["items"] if p["category"] == "tool_execution_failure")["resolved_at"]
    assert c.post(f"/api/v1/problems/{tf['id']}/reopen", headers=H(admin)).status_code == 200
    assert not next(p for p in c.get("/api/v1/problems", headers=H(admin)).json()["items"] if p["category"] == "tool_execution_failure")["resolved_at"]
