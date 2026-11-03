import os, sys, pathlib
os.environ["AUTH_PBKDF2_ITERATIONS"] = "1000"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from agentguard import AgentGuard, AgentGuardError, AgentGuardUnavailable, ApprovalRejected, ApprovalTimeout, ToolCallBlocked

PW = "correct-horse-battery"
def H(t): return {"Authorization": f"Bearer {t}"}

class ApiTransport:
    """Runs the SDK against the real FastAPI app in-process (same code path as HTTP)."""
    def __init__(self, client, key): self.c, self.key, self.down = client, key, False
    def request(self, method, path, body=None):
        if self.down: raise AgentGuardUnavailable("network down")
        r = self.c.request(method, path, json=body, headers=H(self.key))
        if r.status_code >= 500: raise AgentGuardUnavailable("5xx")
        if r.status_code >= 400: raise AgentGuardError(r.status_code, r.json().get("error", {}).get("message", ""))
        return r.json()

@pytest.fixture
def world():
    c = TestClient(create_app("sqlite:///:memory:", auth_required=True))
    admin = c.post("/api/v1/auth/setup", json={"email": "a@x.io", "password": PW}).json()["token"]
    c.post("/api/v1/users", headers=H(admin), json={"email": "m@x.io", "role": "member", "password": PW}); member = c.post("/api/v1/auth/login", json={"email": "m@x.io", "password": PW}).json()["token"]
    key = c.post("/api/v1/api-keys", headers=H(admin), json={"name": "sdk"}).json()["key"]
    def pol(name, cond, action, tools):
        assert c.post("/api/v1/policies", headers=H(admin), json={"name": name, "definition": {"scope": {"tools": tools}, "condition": cond, "action": action, "severity": "high"}}).status_code == 201
    pol("no_dupe_refund", {"type": "duplicate_call"}, "BLOCK", ["issue_refund"])
    pol("big_refund_needs_approval", {"type": "argument_compare", "field": "amount", "op": "gt", "value": 100}, "REQUIRE_APPROVAL", ["issue_refund"])
    calls = []
    def mk(mode="enforce", **kw):
        g = AgentGuard(mode=mode, transport=ApiTransport(c, key), sleep=kw.pop("sleep", lambda s: None), **kw)
        g.register_tool("get_order", lambda order_id: {"order_id": order_id, "status": "delivered"}, read_only=True)
        g.register_tool("issue_refund", lambda order_id, amount: calls.append((order_id, amount)) or {"refunded": amount}, consequential=True)
        return g
    return type("W", (), dict(c=c, admin=admin, member=member, key=key, mk=mk, calls=calls))

def test_blocked_tool_is_never_executed(world):
    g = world.mk()
    with g.trace("support", "Refund A1") as run:
        run.tools.get_order(order_id="A1"); run.tools.issue_refund(order_id="A1", amount=20); assert world.calls == [("A1", 20)]
        with pytest.raises(ToolCallBlocked) as e: run.tools.issue_refund(order_id="A1", amount=20)
        assert "already succeeded" in str(e.value) and world.calls == [("A1", 20)]            # the function did NOT run a second time
        run.finish(claimed_success=False)
    t = world.c.get(f"/api/v1/traces/{run.trace_id}", headers=H(world.admin)).json()
    assert t["outcome"] == "blocked" and t["blocked_actions"] == 1 and t["tool_calls"] == 2
    types = [e["event_type"] for e in t["events"]]; assert types.count("policy_check") == 3 and types[-1] == "run_end"          # check, check, blocked check, then the end

def test_observe_mode_runs_everything_but_records_the_violation(world):
    g = world.mk("observe")
    with g.trace("support", "Refund A1") as run:
        run.tools.issue_refund(order_id="A1", amount=20); run.tools.issue_refund(order_id="A1", amount=20)        # would be blocked in enforce mode
        run.finish(claimed_success=True)
    assert len(world.calls) == 2
    checks = [e for e in world.c.get(f"/api/v1/traces/{run.trace_id}", headers=H(world.admin)).json()["events"] if e["event_type"] == "policy_check"]
    assert checks[1]["metadata"]["decision"] == "BLOCK" and checks[1]["metadata"]["effective"] == "ALLOW"

def test_approval_flow_waits_then_runs_exactly_once(world):
    approved = {"n": 0}
    def human(_):                                           # the "human" answers while the agent is waiting
        pend = world.c.get("/api/v1/approvals?status=pending", headers=H(world.member)).json()["items"]
        if pend: approved["n"] += 1; world.c.post(f"/api/v1/approvals/{pend[0]['id']}/decision", headers=H(world.member), json={"decision": "approve", "note": "ok"})
    g = world.mk(sleep=human)
    with g.trace("support", "Big refund") as run:
        out = run.tools.issue_refund(order_id="B2", amount=500); assert out == {"refunded": 500} and world.calls == [("B2", 500)] and approved["n"] == 1
        run.finish(claimed_success=True)
    ev = world.c.get(f"/api/v1/traces/{run.trace_id}", headers=H(world.admin)).json()["events"]; types = [e["event_type"] for e in ev]
    assert types.index("human_approval") < types.index("tool_call")                                  # the audit trail shows the approval BEFORE the action
    a = [e for e in ev if e["event_type"] == "human_approval"][0]; assert a["metadata"]["approval_id"] and a["metadata"]["approver"] == "[REDACTED_EMAIL]"     # emails are redacted even here
    assert world.c.get(f"/api/v1/approvals/{a['metadata']['approval_id']}", headers=H(world.member)).json()["decided_by"] == "m@x.io"       # the real identity is kept on the approval itself
    assert world.c.get(f"/api/v1/traces/{run.trace_id}/analysis", headers=H(world.admin)).json()["findings"] == []   # approved + verified = nothing to flag

def test_rejected_and_timed_out_approvals_never_run_the_tool(world):
    def reject(_):
        pend = world.c.get("/api/v1/approvals?status=pending", headers=H(world.member)).json()["items"]
        if pend: world.c.post(f"/api/v1/approvals/{pend[0]['id']}/decision", headers=H(world.member), json={"decision": "reject", "note": "customer is under review"})
    with world.mk(sleep=reject).trace("support", "x") as run:
        with pytest.raises(ApprovalRejected) as e: run.tools.issue_refund(order_id="C3", amount=900)
        assert "customer is under review" in str(e.value)
    g = world.mk(approval_timeout=0.0)
    with g.trace("support", "y") as run2:
        with pytest.raises(ApprovalTimeout) as e: run2.tools.issue_refund(order_id="D4", amount=900)
    assert world.calls == []

def test_fail_closed_in_enforce_and_fail_open_in_observe(world):
    g = world.mk("enforce"); g.transport.down = True
    with g.trace("support", "x") as run:
        with pytest.raises(ToolCallBlocked) as e: run.tools.get_order(order_id="1")
        assert "fails closed" in str(e.value)
    o = world.mk("observe"); o.transport.down = True
    with o.trace("support", "x") as run:
        assert run.tools.get_order(order_id="1")["status"] == "delivered"                      # telemetry loss never stops an observe-mode agent
    assert world.mk("enforce", fail_mode="open").fail_mode == "open"

def test_tool_errors_are_recorded_and_exceptions_propagate(world):
    g = world.mk(); g.register_tool("flaky", lambda: (_ for _ in ()).throw(TimeoutError("slow")), read_only=True)
    with pytest.raises(TimeoutError):
        with g.trace("support", "x") as run: run.tools.flaky()
    t = world.c.get(f"/api/v1/traces/{run.trace_id}", headers=H(world.admin)).json(); res = [e for e in t["events"] if e["event_type"] == "tool_result"][0]
    assert res["status"] == "error" and res["error_type"] == "TimeoutError" and t["events"][-1]["metadata"]["claimed_success"] is False

def test_run_agent_wrapper_and_low_level_api(world):
    def agent(task, tools):
        order = tools.get_order(order_id="E5"); return {"success": True, "response": f"Order {order['order_id']} is {order['status']}"}
    g = world.mk()
    with g.trace("support", "Check E5", required_tools=["get_order"]) as run: assert run.run_agent(agent)["success"]
    t = world.c.get(f"/api/v1/traces/{run.trace_id}", headers=H(world.admin)).json(); assert t["outcome"] == "succeeded" and t["task"] == "Check E5" and t["finding_count"] == 0
    low = g.start_trace("order-agent", "Check order status"); low.record_tool_call("get_order", {"order_id": "ORD-101"}, read_only=True); low.record_tool_result("success", {"status": "shipped"}); low.finish(claimed_success=True)
    t2 = world.c.get(f"/api/v1/traces/{low.trace_id}", headers=H(world.admin)).json(); assert [e["event_type"] for e in t2["events"]] == ["run_start", "tool_call", "tool_result", "run_end"] and t2["events"][2]["tool_name"] == "get_order"
    with pytest.raises(KeyError): g.trace("support", "x").call_tool("not_registered")

def test_bad_api_key_is_reported_clearly(world):
    g = world.mk(); g.transport.key = "ag_wrong"
    with g.trace("support", "x") as run:
        with pytest.raises(AgentGuardError) as e: run.tools.get_order(order_id="1")
        assert e.value.status == 401
