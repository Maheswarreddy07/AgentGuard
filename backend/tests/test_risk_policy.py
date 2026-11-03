import pytest
from pydantic import ValidationError
from app.detectors.rules import run_all
from app.risk.engine import assess, predict_run, resolve_outcomes
from app.runtime import policy_engine as PE
from app.schemas.events import EventType as T, Status
from app.services.settings import Config
from tests.test_rules import ev

CFG = Config()
def res(i, tool="x", ok=True, **kw): return ev(i, T.TOOL_RESULT, tool_name=tool, status=Status.OK if ok else Status.ERROR, error_type=None if ok else "500", **kw)
def call(i, tool="x", args=None, **kw): return ev(i, T.TOOL_CALL, tool_name=tool, tool_input=args or {}, **kw)

# ---------------- risk ----------------
def test_clean_run_has_no_risk_and_every_point_is_explained():
    assert assess([ev(0, T.RUN_START), call(1), res(2)], CFG).score == 0
    r = assess([ev(0, T.RUN_START), call(1), res(2, ok=False), call(3), res(4, ok=False), call(5), res(6, ok=False)], CFG)
    assert r.predicted_failure == "repeated_failures" and r.score >= 35 and r.level in ("medium", "high", "critical")
    assert abs(r.score - sum(s["points"] for s in r.signals)) <= 1 and all(s["detail"] for s in r.signals) and r.evidence   # score = sum of named signals

def test_intended_action_is_scored_before_it_runs():
    start = ev(0, T.RUN_START, metadata={"must_precede": [["verify", "refund"]], "constraints": [{"tool": "refund", "field": "amount", "max": 100}]})
    r = assess([start], CFG, {"tool": "refund", "args": {"amount": 500}, "consequential": True})
    kinds = {s["predicts"] for s in r.signals}; assert {"workflow_invariant_violation", "unauthorized_action", "goal_constraint_violation"} <= kinds and r.level == "critical" and r.recommended_action == "escalate"
    ok = assess([start, call(1, "verify"), res(2, "verify"), ev(3, T.HUMAN_APPROVAL, metadata={"approved": True, "approves_tool": "refund"})], CFG, {"tool": "refund", "args": {"amount": 50}, "consequential": True})
    assert ok.score == 0
    assert assess([start], CFG, {"tool": "x", "args": {}, "arg_schema": {"required": ["id"]}}).predicted_failure == "invalid_tool_arguments"

def test_budget_loop_and_duplicate_signals():
    b = [ev(0, T.RUN_START, metadata={"budget": {"max_tool_calls": 10}})] + [e for i in range(1, 10) for e in (call(i * 2 - 1, "t", {"i": i}), res(i * 2, "t", tool_output={"n": i}))]
    assert assess(b, CFG).predicted_failure == "resource_exhaustion"
    cyc = []
    for i in range(2): cyc += [call(i * 4, "a", {"x": 1}), res(i * 4 + 1, "a"), call(i * 4 + 2, "b", {"y": 1}), res(i * 4 + 3, "b")]
    cyc += [call(8, "a", {"x": 1}), res(9, "a")]
    assert assess(cyc, CFG, {"tool": "b", "args": {"y": 1}}).predicted_failure == "infinite_loop"          # the 3rd full cycle is about to complete: the cycle is the stronger explanation
    assert assess(cyc[:-2] + [], CFG, {"tool": "a", "args": {"x": 1}}).predicted_failure == "repeated_tool_calls"   # earlier, the repeated call is what is visible
    dup = [call(0, "g", {"id": 1}), res(1, "g"), call(2, "g", {"id": 1}), res(3, "g")]
    assert assess(dup, CFG, {"tool": "g", "args": {"id": 1}}).predicted_failure == "repeated_tool_calls"

def test_warnings_precede_the_failure_and_are_scored_against_what_really_happened():
    evs = [ev(0, T.RUN_START)]; step = 1
    for _ in range(4): evs += [call(step, "api"), res(step + 1, "api", ok=False)]; step += 2
    evs.append(ev(step, T.RUN_END, metadata={"claimed_success": False}))
    peak, alerts = predict_run(evs, CFG); findings = run_all(evs); alerts = resolve_outcomes(alerts, findings, {e.event_id: e.step_index for e in evs}, finished=True)
    a = [x for x in alerts if x["predicted_failure"] == "repeated_failures"][0]
    assert a["outcome"] == "occurred" and a["lead_steps"] is not None and a["lead_steps"] >= 1 and peak >= 35     # warned BEFORE the loop became detectable
    wrong = resolve_outcomes([{"step_index": 1, "predicted_failure": "resource_exhaustion"}], findings, {e.event_id: e.step_index for e in evs}, finished=True)
    assert wrong[0]["outcome"] == "not_occurred"                                                                                       # a warning that did not come true is counted as wrong

# ---------------- policy engine ----------------
def D(cond, action="BLOCK", **kw): return PE.PolicyDef.model_validate({"condition": cond, "action": action, **kw})
def ctx(tool="issue_refund", args=None, **kw): return PE.Context(agent="support", tool=tool, args=args or {}, **kw)
def run(d, c, mode="enforce"): return PE.decide([(1, "p", 1, d)], c, mode)

def test_each_condition_type_with_reasons():
    assert run(D({"type": "tool_denylist", "tools": ["rm"]}), ctx("rm")).raw == "BLOCK" and run(D({"type": "tool_denylist", "tools": ["rm"]}), ctx("ls")).raw == "ALLOW"
    assert run(D({"type": "tool_allowlist", "tools": ["ls"]}), ctx("rm")).raw == "BLOCK" and run(D({"type": "tool_allowlist", "tools": ["ls"]}), ctx("ls")).raw == "ALLOW"
    big = D({"type": "argument_compare", "field": "amount", "op": "gt", "value": 100}, "REQUIRE_APPROVAL")
    assert run(big, ctx(args={"amount": 150})).raw == "REQUIRE_APPROVAL" and run(big, ctx(args={"amount": 50})).raw == "ALLOW" and run(big, ctx(args={})).raw == "ALLOW"
    nested = D({"type": "argument_compare", "field": "customer.tier", "op": "in", "value": ["gold"]}, "WARN"); assert run(nested, ctx(args={"customer": {"tier": "gold"}})).raw == "WARN"
    assert "limit is 2" in run(D({"type": "tool_call_count_above", "limit": 2}), ctx(history=[call(0), call(1)])).reason()
    done = [call(0, "issue_refund", {"o": 1}), res(1, "issue_refund")]
    assert run(D({"type": "duplicate_call"}), ctx(args={"o": 1}, history=done)).raw == "BLOCK" and run(D({"type": "duplicate_call"}), ctx(args={"o": 2}, history=done)).raw == "ALLOW"
    req = D({"type": "requires_prior", "tool": "verify"}); assert run(req, ctx()).raw == "BLOCK" and run(req, ctx(history=[call(0, "verify"), res(1, "verify")])).raw == "ALLOW"
    assert run(D({"type": "budget_exceeded", "metric": "cost_usd", "limit": 1.0}), ctx(history=[ev(0, T.MODEL_REQUEST, cost_usd=2.0)])).raw == "BLOCK"
    assert run(D({"type": "sensitive_in_arguments", "types": ["ssn"]}), ctx(args={"note": "123-45-6789"})).raw == "BLOCK" and run(D({"type": "sensitive_in_arguments", "types": ["ssn"]}), ctx(args={"note": "hello"})).raw == "ALLOW"
    assert run(D({"type": "actor_role_not_in", "roles": ["admin"]}), ctx(actor_role="intern")).raw == "BLOCK" and run(D({"type": "actor_role_not_in", "roles": ["admin"]}), ctx(actor_role="admin")).raw == "ALLOW"

def test_scope_precedence_and_every_decision_is_explained():
    scoped = D({"type": "tool_denylist", "tools": ["x"]}, scope={"agents": ["other"], "tools": ["*"]}); assert run(scoped, ctx("x")).evaluated == []        # out of scope: not evaluated at all
    pols = [(1, "warn", 1, D({"type": "tool_denylist", "tools": ["x"]}, "WARN")), (2, "block", 1, D({"type": "tool_denylist", "tools": ["x"]}, "BLOCK", message="Never")), (3, "appr", 1, D({"type": "tool_denylist", "tools": ["x"]}, "REQUIRE_APPROVAL"))]
    d = PE.decide(pols, ctx("x")); assert d.raw == "BLOCK" and "[block] Never" in d.reason() and len(d.matches) == 3

def test_modes_observe_warn_enforce():
    d = D({"type": "tool_denylist", "tools": ["x"]}); c = ctx("x")
    assert (run(d, c, "observe").raw, run(d, c, "observe").effective) == ("BLOCK", "ALLOW")        # observe: decision recorded, never enforced
    assert run(d, c, "warn").effective == "WARN" and run(d, c, "enforce").effective == "BLOCK"
    assert run(D({"type": "tool_denylist", "tools": ["x"]}), ctx("y"), "warn").effective == "ALLOW"

def test_approval_satisfies_approval_policies_but_never_a_block():
    appr = D({"type": "missing_approval"}, "REQUIRE_APPROVAL")
    assert run(appr, ctx(consequential=True)).effective == "REQUIRE_APPROVAL" and run(appr, ctx(consequential=True, approval_ok=True)).effective == "ALLOW"
    both = [(1, "a", 1, appr), (2, "deny", 1, D({"type": "tool_denylist", "tools": ["issue_refund"]}))]
    assert PE.decide(both, ctx(consequential=True, approval_ok=True)).effective == "BLOCK"                    # an approval can never override a block

@pytest.mark.parametrize("bad", [{"type": "argument_compare"}, {"type": "argument_compare", "field": "a", "op": "regex", "value": "("}, {"type": "budget_exceeded", "limit": 1}, {"type": "tool_denylist"},
                                 {"type": "argument_compare", "field": "a", "op": "in", "value": 3}, {"type": "nope"}])
def test_invalid_policy_definitions_are_rejected(bad):
    with pytest.raises(ValidationError): D(bad)
def test_invalid_action_rejected():
    with pytest.raises(ValidationError): D({"type": "duplicate_call"}, "DESTROY")

def test_every_condition_type_has_a_ui_spec_matching_the_model():
    assert set(PE.CONDITION_SPECS) == set(PE.CondType.__args__)
    fields = set(PE.Condition.model_fields)
    for t, spec in PE.CONDITION_SPECS.items():
        assert spec["label"] and spec["help"] and all(f["name"] in fields for f in spec["fields"]), t
