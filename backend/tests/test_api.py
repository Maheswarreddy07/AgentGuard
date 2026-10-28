from datetime import datetime, timezone
from fastapi.testclient import TestClient
from app.main import create_app

def E(i, t, **kw):
    return {"trace_id": "t1", "run_id": "r", "event_id": f"e{i}", "agent_name": "a", "event_type": t,
            "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(), "step_index": i, **kw}

def client(): return TestClient(create_app("sqlite:///:memory:"))

def test_health(): assert client().get("/health").json()["status"] == "ok"

def test_ingest_detect_localize_and_redact():
    c = client()
    evs = [E(0, "run_start"),
           E(1, "tool_call", tool_name="login", tool_input={"password": "hunter2", "email": "a@b.com"}),
           E(2, "tool_result", tool_name="login", status="error", error_type="500"),
           E(3, "run_end", metadata={"claimed_success": True})]
    r = c.post("/api/v1/traces", json={"trace_id": "t1", "events": evs}); assert r.status_code == 201
    tr = c.get("/api/v1/traces/t1").json()
    assert tr["events"][1]["tool_input"] == {"password": "[REDACTED]", "email": "[REDACTED_EMAIL]"}
    a = c.get("/api/v1/traces/t1/analysis").json()
    cats = {f["category"] for f in a["findings"]}
    assert {"tool_execution_failure", "unsupported_success_claim"} <= cats
    assert a["localization"]["first_detectable_event_id"] == "e2"

def test_duplicates_and_out_of_order():
    c = client()
    c.post("/api/v1/traces", json={"trace_id": "t1", "events": [E(1, "run_end")]})
    r = c.post("/api/v1/traces/t1/events", json={"events": [E(1, "run_end"), E(0, "run_start")]}).json()
    assert r == {"accepted": 1, "duplicates": 1}
    assert [e["step_index"] for e in c.get("/api/v1/traces/t1").json()["events"]] == [0, 1]

def test_validation_and_404_and_pagination():
    c = client()
    assert c.post("/api/v1/traces", json={"trace_id": "t1", "events": [{"bad": 1}]}).status_code == 422
    assert c.post("/api/v1/traces", json={"trace_id": "t2", "events": [E(0, "run_start")]}).status_code == 422  # trace mismatch
    assert c.get("/api/v1/traces/nope").status_code == 404
    c.post("/api/v1/traces", json={"trace_id": "t1", "events": [E(0, "run_start")]})
    assert c.get("/api/v1/traces?limit=1").json()["total"] == 1
