import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
import pytest
from agentguard_sdk import Tracer

def test_records_and_propagates_errors():
    sent = {}
    t = Tracer("a", lambda tid, ev: sent.update(tid=tid, ev=ev))
    with pytest.raises(ValueError):
        with t.run() as r:
            r.call("x", {}, fn=lambda: (_ for _ in ()).throw(ValueError("boom")))
    assert [e["event_type"] for e in sent["ev"]] == ["run_start", "tool_call", "tool_result"] and sent["ev"][-1]["status"] == "error"

def test_transport_failure_does_not_break_agent():
    def bad(*a): raise ConnectionError()
    with Tracer("a", bad).run() as r:
        assert r.call("x", {"v": 1}, fn=lambda v: v + 1) == 2

def test_sdk_events_accepted_by_real_api_and_flagged():
    from fastapi.testclient import TestClient
    from app.main import create_app
    c = TestClient(create_app("sqlite:///:memory:"))
    def post(tid, ev): assert c.post("/api/v1/traces", json={"trace_id": tid, "events": ev}).status_code == 201
    with Tracer("a", post).run() as r:
        r.call("refund", {"amount": 5}, fn=lambda amount: {"ok": True}, consequential=True)  # no approval
        r.finish(True)
    tid = c.get("/api/v1/traces").json()["items"][0]["trace_id"]
    assert "unauthorized_action" in {f["category"] for f in c.get(f"/api/v1/traces/{tid}/analysis").json()["findings"]}
