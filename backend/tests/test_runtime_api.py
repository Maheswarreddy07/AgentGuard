import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.db.models import ApprovalRow
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2] / "benchmarks/scenarios"; PW = "correct-horse-battery"
def H(tok): return {"Authorization": f"Bearer {tok}"}
def EV(trace, i, t, agent="support", **kw):
    return {"trace_id": trace, "run_id": trace, "event_id": f"{trace}-e{i}", "agent_name": agent, "event_type": t, "timestamp": (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=i)).isoformat(), "step_index": i, **kw}

@pytest.fixture
def env(tmp_path):
    shutil.copytree(ROOT / "v1", tmp_path / "v1"); app = create_app("sqlite:///:memory:", tmp_path, auth_required=True); c = TestClient(app)
    admin = c.post("/api/v1/auth/setup", json={"email": "admin@a.io", "password": PW, "name": "Ada"}).json()["token"]
    def user(role): 
        c.post("/api/v1/users", headers=H(admin), json={"email": f"{role}@a.io", "role": role, "password": PW}); return c.post("/api/v1/auth/login", json={"email": f"{role}@a.io", "password": PW}).json()["token"]
    key = c.post("/api/v1/api-keys", headers=H(admin), json={"name": "agent"}).json()["key"]
    return type("Env", (), dict(c=c, app=app, admin=admin, member=user("member"), viewer=user("viewer"), key=key))

class Run:
    """What the SDK does: send events, ask permission before each tool."""
    def __init__(s, env, trace="r1", mode="enforce", key=None):
        s.e, s.c, s.trace, s.mode, s.key, s.step = env, env.c, trace, mode, key or env.key, 0
        s.send("run_start", metadata={"task": "Refund order", "mode": mode, "environment": "staging"})
    def send(s, t, **kw):
        s.c.post("/api/v1/traces", headers=H(s.key), json={"trace_id": s.trace, "events": [EV(s.trace, s.step, t, **kw)]}); s.step += 1
    def check(s, tool, args, **kw):
        r = s.c.post("/api/v1/runtime/check", headers=H(s.key), json={"trace_id": s.trace, "agent_name": "support", "tool_name": tool, "arguments": args, "mode": s.mode, "step_index": s.step, **kw}).json()
        s.step += r.get("consumed_steps", 0); return r
    def execute(s, tool, args, ok=True, **kw):
        s.send("tool_call", tool_name=tool, tool_input=args, metadata=kw); s.send("tool_result", tool_name=tool, tool_output={"ok": True} if ok else None, status="ok" if ok else "error")

def policy(env, name, cond, action, tools=("*",), **kw):
    r = env.c.post("/api/v1/policies", headers=H(env.admin), json={"name": name, "category": kw.pop("category", "custom"), "definition": {"scope": {"tools": list(tools)}, "condition": cond, "action": action, "severity": "high", "message": kw.pop("message", "")}, **kw})
    assert r.status_code == 201, r.text; return r.json()

# ------------------------------------------------ policies ------------------------------------------------
def test_policy_crud_validation_versioning_and_roles(env):
    c = env.c; d = {"scope": {"tools": ["x"]}, "condition": {"type": "tool_denylist", "tools": ["x"]}, "action": "BLOCK"}
    assert c.post("/api/v1/policies", headers=H(env.member), json={"name": "p1", "definition": d}).status_code == 403          # only admins write policy
    bad = c.post("/api/v1/policies", headers=H(env.admin), json={"name": "p1", "definition": {"condition": {"type": "argument_compare"}, "action": "BLOCK"}}); assert bad.status_code == 422 and "field" in bad.json()["error"]["message"]
    p = policy(env, "p1", {"type": "tool_denylist", "tools": ["x"]}, "BLOCK", tools=["x"]); assert p["version"] == 1 and p["enabled"]
    assert c.post("/api/v1/policies", headers=H(env.admin), json={"name": "p1", "definition": d}).status_code == 409
    v2 = c.put(f"/api/v1/policies/{p['id']}", headers=H(env.admin), json={"definition": {**d, "action": "WARN"}, "note": "soften"}).json(); assert v2["version"] == 2 and v2["n_versions"] == 2
    assert c.put(f"/api/v1/policies/{p['id']}", headers=H(env.admin), json={"definition": {**d, "action": "WARN"}}).json()["version"] == 2                  # unchanged definition = no new version
    rb = c.post(f"/api/v1/policies/{p['id']}/rollback", headers=H(env.admin), json={"version": 1}).json(); assert rb["version"] == 3 and rb["definition"]["action"] == "BLOCK" and len(rb["versions"]) == 3
    assert c.post(f"/api/v1/policies/{p['id']}/rollback", headers=H(env.admin), json={"version": 9}).status_code == 404
    off = c.post(f"/api/v1/policies/{p['id']}/toggle", headers=H(env.admin), json={"enabled": False}).json(); assert off["enabled"] is False
    run = Run(env); assert run.check("x", {})["effective"] == "ALLOW"                                                                                       # disabled policies do nothing
    tpl = c.get("/api/v1/policies/templates", headers=H(env.viewer)).json(); assert len(tpl["items"]) >= 5
    for t in tpl["items"]: assert c.post("/api/v1/policies", headers=H(env.admin), json={"name": t["name"], "category": t["category"], "definition": t["definition"]}).status_code == 201

def test_policy_test_and_simulate_endpoints_change_nothing(env):
    c = env.c; d = {"scope": {"tools": ["issue_refund"]}, "condition": {"type": "argument_compare", "field": "amount", "op": "gt", "value": 100}, "action": "BLOCK"}
    t = c.post("/api/v1/policies/test", headers=H(env.viewer), json={"definition": d, "context": {"tool": "issue_refund", "args": {"amount": 500}}}).json(); assert t["matched"] and t["effective"] == "BLOCK" and "500" in t["explanation"]
    assert not c.post("/api/v1/policies/test", headers=H(env.viewer), json={"definition": d, "context": {"tool": "other", "args": {"amount": 500}}}).json()["in_scope"]
    run = Run(env, "hist", key=env.admin); run.execute("issue_refund", {"amount": 500}); run.execute("issue_refund", {"amount": 20}); run.send("run_end", metadata={"claimed_success": True})
    sim = c.post("/api/v1/policies/simulate", headers=H(env.viewer), json={"definition": d}).json(); assert sim["would_trigger"] == 1 and sim["samples"][0]["tool"] == "issue_refund" and sim["tool_calls_examined"] >= 2
    assert c.get("/api/v1/policies/evaluations", headers=H(env.viewer)).json()["total"] == 0                                                                   # simulation is not logged as a real decision

# ------------------------------------------------ enforcement ------------------------------------------------
def test_block_is_decided_before_the_tool_runs_and_is_visible_in_the_trace(env):
    policy(env, "no_dupe_refund", {"type": "duplicate_call"}, "BLOCK", tools=["issue_refund"], message="Duplicate refund")
    run = Run(env); first = run.check("issue_refund", {"order": "A1"}); assert first["allowed"] and first["effective"] == "ALLOW"
    run.execute("issue_refund", {"order": "A1"})
    second = run.check("issue_refund", {"order": "A1"}); assert second["effective"] == "BLOCK" and not second["allowed"] and "Duplicate refund" in second["reason"] and second["matches"][0]["name"] == "no_dupe_refund"
    run.send("run_end", metadata={"claimed_success": False})
    t = env.c.get("/api/v1/traces/r1", headers=H(env.viewer)).json(); pcs = [e for e in t["events"] if e["event_type"] == "policy_check"]
    assert [e["metadata"]["effective"] for e in pcs] == ["ALLOW", "BLOCK"] and t["blocked_actions"] == 1 and t["outcome"] == "blocked"
    assert t["task"] == "Refund order" and t["mode"] == "enforce" and t["environment"] == "staging" and t["tool_calls"] == 1                        # the blocked call never became a tool_call
    log = env.c.get("/api/v1/policies/evaluations?matched_only=true", headers=H(env.viewer)).json()["items"]; assert log[0]["effective"] == "BLOCK" and log[0]["context"]["args"] == {"order": "A1"} and log[0]["version"] == 1

def test_observe_and_warn_modes_record_but_never_stop(env):
    policy(env, "deny", {"type": "tool_denylist", "tools": ["rm"]}, "BLOCK", tools=["rm"])
    obs = Run(env, "o", "observe").check("rm", {}); assert obs["decision"] == "BLOCK" and obs["effective"] == "ALLOW" and obs["allowed"]
    warn = Run(env, "w", "warn").check("rm", {}); assert warn["decision"] == "BLOCK" and warn["effective"] == "WARN" and warn["allowed"]
    enf = Run(env, "e", "enforce").check("rm", {}); assert not enf["allowed"]

def test_approval_lifecycle_is_single_use_and_cannot_be_bypassed(env):
    c = env.c; policy(env, "big_refund", {"type": "argument_compare", "field": "amount", "op": "gt", "value": 100}, "REQUIRE_APPROVAL", tools=["issue_refund"], category="approval")
    run = Run(env); args = {"order": "A1", "amount": 250}; r = run.check("issue_refund", args)
    assert not r["allowed"] and r["effective"] == "REQUIRE_APPROVAL" and r["approval_request_id"]; aid = r["approval_request_id"]
    assert run.check("issue_refund", args)["approval_request_id"] == aid                                                                                       # same request is reused, not duplicated
    assert c.get("/api/v1/approvals?status=pending", headers=H(env.viewer)).json()["pending"] == 1
    d = {"decision": "approve", "note": ""}
    assert c.post(f"/api/v1/approvals/{aid}/decision", headers=H(env.key), json=d).status_code == 403                                                         # an agent cannot approve itself
    assert c.post(f"/api/v1/approvals/{aid}/decision", headers=H(env.viewer), json=d).status_code == 403
    assert c.post(f"/api/v1/approvals/{aid}/decision", headers=H(env.member), json={"decision": "reject", "note": ""}).status_code == 422                          # rejections need a reason
    ap = c.get(f"/api/v1/approvals/{aid}", headers=H(env.member)).json(); assert ap["arguments"] == args and ap["status"] == "pending" and ap["evidence"] and ap["policy_name"] == "big_refund"
    assert c.post(f"/api/v1/approvals/{aid}/decision", headers=H(env.member), json=d).json()["status"] == "approved"
    assert c.post(f"/api/v1/approvals/{aid}/decision", headers=H(env.member), json=d).status_code == 409                                                       # decided once
    assert c.get(f"/api/v1/approvals/{aid}", headers=H(env.key)).json()["status"] == "approved"                                                               # the agent can poll
    assert run.check("issue_refund", {"order": "A1", "amount": 999}, approval_id=aid)["effective"] == "REQUIRE_APPROVAL"                                       # approval is for THESE arguments only
    ok = run.check("issue_refund", args, approval_id=aid); assert ok["allowed"] and ok["effective"] == "ALLOW"
    again = run.check("issue_refund", args, approval_id=aid); assert not again["allowed"] and again["approval_request_id"] != aid                                  # one approval = one execution

def test_rejection_sticks_and_expiry_allows_a_fresh_request(env):
    c = env.c; policy(env, "appr", {"type": "tool_denylist", "tools": ["wire"]}, "REQUIRE_APPROVAL", tools=["wire"])
    run = Run(env); aid = run.check("wire", {"n": 1})["approval_request_id"]
    c.post(f"/api/v1/approvals/{aid}/decision", headers=H(env.member), json={"decision": "reject", "note": "wrong account"})
    blocked = run.check("wire", {"n": 1}); assert blocked["effective"] == "BLOCK" and "wrong account" in blocked["reason"]
    aid2 = run.check("wire", {"n": 2})["approval_request_id"]
    with env.app.state.factory() as db:
        a = db.get(ApprovalRow, aid2); a.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1); db.commit()
    assert c.get(f"/api/v1/approvals/{aid2}", headers=H(env.key)).json()["status"] == "expired"                                                                 # nobody answered: treated as rejected
    assert c.post(f"/api/v1/approvals/{aid2}/decision", headers=H(env.member), json={"decision": "approve"}).status_code == 409
    assert run.check("wire", {"n": 2})["approval_request_id"] not in (aid2, None)

def test_approval_never_overrides_a_block(env):
    policy(env, "needs_approval", {"type": "missing_approval"}, "REQUIRE_APPROVAL"); policy(env, "deny", {"type": "tool_denylist", "tools": ["nuke"]}, "BLOCK", tools=["nuke"])
    run = Run(env); aid = run.check("nuke", {}, consequential=True)["approval_request_id"]
    r = run.check("nuke", {}, consequential=True, approval_id=aid); assert r["effective"] == "BLOCK" and not r["allowed"]

# ------------------------------------------------ risk, findings, agents, runs ------------------------------------------------
def test_risk_is_reported_before_the_action_and_tracked(env):
    run = Run(env, "risky", "observe"); r = run.check("issue_refund", {"amount": 5}, consequential=True)
    assert r["risk"]["predicted_failure"] == "unauthorized_action" and r["risk"]["score"] >= 50 and r["risk"]["evidence"] and r["risk"]["recommended_action"] == "escalate"
    run.execute("issue_refund", {"amount": 5}, consequential=True); run.send("run_end", metadata={"claimed_success": True})
    t = env.c.get("/api/v1/traces/risky", headers=H(env.viewer)).json(); assert any(e["event_type"] == "risk_detected" for e in t["events"]) and t["risk_score"] >= 50
    mon = env.c.get("/api/v1/risk/monitor", headers=H(env.viewer)).json(); assert mon["items"][0]["trace_id"] == "risky" and mon["items"][0]["prediction"]["predicted_failure"] == "unauthorized_action"
    preds = env.c.get("/api/v1/risk/predictions?trace_id=risky", headers=H(env.viewer)).json(); assert preds["items"][0]["outcome"] == "occurred"                      # it really happened (observe mode let it run)
    m = env.c.get("/api/v1/risk/metrics", headers=H(env.viewer)).json(); assert m["n_resolved"] >= 1 and m["precision"] == 1.0 and m["recall"] is not None and "definitions" in m

def test_findings_agents_and_run_facts(env):
    run = Run(env, "facts", "observe"); run.send("model_request", tokens_in=100, tokens_out=50, cost_usd=0.01); run.execute("get", {"id": 1}, ok=False)
    run.send("run_end", metadata={"claimed_success": True}); c = env.c
    f = c.get("/api/v1/findings?trace_id=facts", headers=H(env.viewer)).json(); cats = {x["category"] for x in f["items"]}; assert {"tool_execution_failure", "unsupported_success_claim"} <= cats
    top = f["items"][0]; assert top["severity"] == "critical" and top["source"] == "rule" and top["rule"] and top["confidence"] == 1.0 and len(top["id"]) == 24
    assert c.get("/api/v1/findings?severity=critical", headers=H(env.viewer)).json()["total"] >= 1
    t = c.get("/api/v1/traces/facts", headers=H(env.viewer)).json(); assert t["tokens"] == 150 and t["cost_usd"] == 0.01 and t["duration_ms"] is not None and t["outcome"] == "failed" and t["finding_count"] >= 2
    ag = c.get("/api/v1/agents", headers=H(env.viewer)).json()["items"]; assert ag[0]["name"] == "support" and ag[0]["runs"] == 1 and ag[0]["flagged_runs"] == 1
    assert c.post("/api/v1/agents", headers=H(env.member), json={"name": "support"}).status_code == 409 and c.post("/api/v1/agents", headers=H(env.member), json={"name": "new-bot"}).status_code == 201
    exp = c.get("/api/v1/traces/facts/export", headers=H(env.viewer)).json(); assert exp["format"] == "agentguard-trace/1" and exp["events"]
    other = Run(env, "clean-run", "observe"); other.execute("get", {"id": 1}); other.send("run_end", metadata={"claimed_success": True})
    cmp = c.get("/api/v1/traces/compare?a=facts&b=clean-run", headers=H(env.viewer)).json(); assert cmp["first_divergence_step"] is not None and "tool_execution_failure" in cmp["findings"]["only_a"] and not cmp["same_outcome"]

def test_finding_detail_explains_itself_and_respects_workspaces(env):
    run = Run(env, "bad", "observe"); run.execute("get", {"id": 1}, ok=False); run.send("run_end", metadata={"claimed_success": True})
    items = env.c.get("/api/v1/findings?trace_id=bad", headers=H(env.viewer)).json()["items"]; top = items[0]
    d = env.c.get(f"/api/v1/findings/{top['id']}", headers=H(env.viewer)).json()
    assert d["label"] and d["why"] and d["fix"] and d["run"]["trace_id"] == "bad" and d["evidence_events"] and d["evidence_event_ids"] and d["localization"]["resolved"]
    assert {e["event_id"] for e in d["evidence_events"]} <= {e["event_id"] for e in d["context_events"]} and d["source"] == "rule"
    assert env.c.get("/api/v1/findings/" + "0" * 24, headers=H(env.viewer)).status_code == 404
    w = env.c.post("/api/v1/workspaces", headers=H(env.admin), json={"name": "Other Corp", "admin_email": "o@o.io", "admin_password": PW}); assert w.status_code == 201
    other = env.c.post("/api/v1/auth/login", json={"email": "o@o.io", "password": PW}).json()["token"]
    assert env.c.get(f"/api/v1/findings/{top['id']}", headers=H(other)).status_code == 404       # another workspace cannot read it

def test_overview_has_the_new_operational_metrics_and_filters(env):
    policy(env, "appr", {"type": "tool_denylist", "tools": ["wire"]}, "REQUIRE_APPROVAL", tools=["wire"]); run = Run(env, "ov"); run.check("wire", {}); run.send("run_end", metadata={"claimed_success": False})
    live = env.c.get("/api/v1/metrics/overview", headers=H(env.viewer)).json()["live"]; assert live["pending_approvals"] == 1 and live["total_runs"] == 1 and "avg_risk" in live and "total_cost_usd" in live
    assert env.c.get("/api/v1/metrics/overview?agent=nobody", headers=H(env.viewer)).json()["live"]["total_runs"] == 0 and env.c.get("/api/v1/metrics/overview?environment=staging", headers=H(env.viewer)).json()["live"]["total_runs"] == 1

# ------------------------------------------------ keys & isolation ------------------------------------------------
def test_api_key_rotation(env):
    c = env.c; kid = c.get("/api/v1/api-keys", headers=H(env.admin)).json()["items"][0]["id"]; new = c.post(f"/api/v1/api-keys/{kid}/rotate", headers=H(env.admin)).json()
    assert new["key"].startswith("ag_") and new["key"] != env.key and new["replaces"] == kid
    body = {"trace_id": "k", "events": [EV("k", 0, "run_start")]}
    assert c.post("/api/v1/traces", headers=H(env.key), json=body).status_code == 401 and c.post("/api/v1/traces", headers=H(new["key"]), json=body).status_code == 201
    assert c.post(f"/api/v1/api-keys/{kid}/rotate", headers=H(env.admin)).status_code == 409

def test_workspaces_are_completely_isolated(env):
    c = env.c
    assert c.post("/api/v1/workspaces", headers=H(env.member), json={"name": "Bee Corp", "admin_email": "b@b.io", "admin_password": PW}).status_code == 403
    w = c.post("/api/v1/workspaces", headers=H(env.admin), json={"name": "Acme B", "admin_email": "boss@b.io", "admin_password": PW}); assert w.status_code == 201
    bt = c.post("/api/v1/auth/login", json={"email": "boss@b.io", "password": PW}).json()["token"]
    assert c.post("/api/v1/workspaces", headers=H(bt), json={"name": "Cee Corp", "admin_email": "c@c.io", "admin_password": PW}).status_code == 403                    # tenants cannot create tenants
    bkey = c.post("/api/v1/api-keys", headers=H(bt), json={"name": "bk"}).json()["key"]
    # same trace id in both workspaces: two separate runs, no leakage either way
    policy(env, "a_policy", {"type": "tool_denylist", "tools": ["x"]}, "BLOCK", tools=["x"]); ra = Run(env, "shared-id"); ra.check("x", {}); aid_a = None
    rb = Run(env, "shared-id", key=bkey); rb.send("model_request"); rb.send("run_end", metadata={"claimed_success": True})
    ta, tb = c.get("/api/v1/traces/shared-id", headers=H(env.admin)).json(), c.get("/api/v1/traces/shared-id", headers=H(bt)).json()
    assert ta["blocked_actions"] == 1 and tb["blocked_actions"] == 0 and len(tb["events"]) == 3 and ta["workspace_id" if "workspace_id" in ta else "trace_id"]
    assert c.get("/api/v1/traces", headers=H(bt)).json()["total"] == 1 and c.get("/api/v1/traces", headers=H(env.admin)).json()["total"] == 1
    assert c.post("/api/v1/runtime/check", headers=H(bkey), json={"trace_id": "shared-id", "agent_name": "support", "tool_name": "x", "arguments": {}}).json()["effective"] == "ALLOW"   # A's policy does not apply to B
    pid = c.get("/api/v1/policies", headers=H(env.admin)).json()["items"][0]["id"]
    for path in (f"/api/v1/policies/{pid}",): assert c.get(path, headers=H(bt)).status_code == 404
    assert c.get("/api/v1/policies", headers=H(bt)).json()["items"] == [] and c.get("/api/v1/findings", headers=H(bt)).json()["total"] == 0 and c.get("/api/v1/agents", headers=H(bt)).json()["items"][0]["runs"] == 1
    assert c.get("/api/v1/approvals", headers=H(bt)).json()["total"] == 0 and len(c.get("/api/v1/users", headers=H(bt)).json()["items"]) == 1 and len(c.get("/api/v1/api-keys", headers=H(bt)).json()["items"]) == 1
    uid_a = c.get("/api/v1/users", headers=H(env.admin)).json()["items"][0]["id"]
    assert c.patch(f"/api/v1/users/{uid_a}", headers=H(bt), json={"role": "viewer"}).status_code == 404 and c.post(f"/api/v1/users/{uid_a}/reset-password", headers=H(bt), json={"new_password": PW + "x"}).status_code == 404
    kid_a = c.get("/api/v1/api-keys", headers=H(env.admin)).json()["items"][0]["id"]; assert c.delete(f"/api/v1/api-keys/{kid_a}", headers=H(bt)).status_code == 404
    assert c.get(f"/api/v1/traces/shared-id/analysis", headers=H(bt)).json()["trace_id"] == "shared-id" and c.get("/api/v1/traces/nope", headers=H(bt)).status_code == 404
    only_a = Run(env, "only-a"); only_a.send("run_end"); assert c.get("/api/v1/traces/only-a", headers=H(bt)).status_code == 404 and c.get("/api/v1/traces/only-a/export", headers=H(bt)).status_code == 404
    c.post("/api/v1/demo/seed", headers=H(bt)); assert c.get("/api/v1/traces/facets", headers=H(env.admin)).json()["total"] == 2                                       # B's demo data never shows up in A
    custom = {"id": "b-only", "category": "c", "description": "d", "task": "t", "events": [{"event_id": "e0", "step_index": 0, "event_type": "run_start"}], "labels": {}}
    assert c.post("/api/v1/scenarios", headers=H(bt), json=custom).status_code == 201 and c.get("/api/v1/scenarios/b-only", headers=H(env.admin)).status_code == 404
    assert "b-only" in [s["id"] for s in c.get("/api/v1/scenarios", headers=H(bt)).json()["items"]] and "b-only" not in [s["id"] for s in c.get("/api/v1/scenarios", headers=H(env.admin)).json()["items"]]
    run = c.post("/api/v1/benchmarks/run", headers=H(bt), json={"scenario_ids": ["b-only"]}).json()["run_id"]; assert c.get(f"/api/v1/benchmarks/{run}", headers=H(env.admin)).status_code == 404
