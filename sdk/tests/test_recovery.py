"""Real recovery: bounded retries, validated fixes, goal verification, and consequential actions are never retried."""
import pytest
from agentguard import Failure, RecoveryExecutor, ToolSpec, ToolCallBlocked, fix_arguments, validate
from tests.test_guard import world  # noqa: F401  (the in-process server fixture)

SCHEMA = {"type": "object", "required": ["order_id", "limit"], "additionalProperties": False,
          "properties": {"order_id": {"type": "string", "minLength": 3}, "limit": {"type": "integer", "minimum": 1, "maximum": 50}, "verbose": {"type": "boolean", "default": False}}}
READ = ToolSpec("lookup", read_only=True, schema=SCHEMA)
def ex(**kw): return RecoveryExecutor(sleep=lambda s: None, jitter=lambda: 0.0, **kw)

class Flaky:
    def __init__(self, fails, error=TimeoutError): self.fails, self.error, self.calls = fails, error, 0
    def __call__(self, **kw):
        self.calls += 1
        if self.calls <= self.fails: raise self.error("slow")
        return {"ok": True, **kw}

def test_a_transient_failure_on_a_read_only_tool_is_retried_until_it_works_and_the_goal_is_verified():
    f = Flaky(2); r = ex().recover(READ, {"order_id": "A-1", "limit": 5}, f, Failure("timeout"), verify=lambda out: out["ok"])
    assert r.recovered and r.verified and r.attempts == 3 and f.calls == 3 and r.terminal == "recovered"

def test_retries_are_bounded():
    f = Flaky(99); r = ex(max_retries=3).recover(READ, {"order_id": "A-1", "limit": 5}, f, Failure("timeout"), verify=lambda o: True)
    assert not r.recovered and r.terminal == "failed" and f.calls == 3 == r.attempts

def test_backoff_doubles_and_is_capped_and_the_time_limit_is_respected():
    waits = []; e = RecoveryExecutor(max_retries=6, base_delay=1, max_delay=4, time_limit=100, sleep=waits.append, jitter=lambda: 1.0)
    e.recover(READ, {"order_id": "A-1", "limit": 5}, Flaky(99), Failure("503"))
    assert waits == [1, 2, 4, 4, 4, 4]
    now = [0.0]; waits2 = []
    def sleep(s): waits2.append(s); now[0] += s
    e2 = RecoveryExecutor(max_retries=10, base_delay=2, max_delay=8, time_limit=7, sleep=sleep, clock=lambda: now[0], jitter=lambda: 1.0)
    r = e2.recover(READ, {"order_id": "A-1", "limit": 5}, Flaky(99), Failure("timeout")); assert sum(waits2) <= 7 and "time limit" in r.reason

def test_success_without_a_goal_check_is_not_counted_as_recovered():
    r = ex().recover(READ, {"order_id": "A-1", "limit": 5}, Flaky(1), Failure("timeout"))
    assert r.terminal == "unverified" and not r.recovered and not r.verified
    r = ex().recover(READ, {"order_id": "A-1", "limit": 5}, Flaky(1), Failure("timeout"), verify=lambda o: False)
    assert r.terminal == "failed" and not r.recovered                                                           # worked, but the original goal was not met

@pytest.mark.parametrize("spec", [ToolSpec("refund", consequential=True), ToolSpec("send_email"), ToolSpec("x", read_only=True, consequential=True)])
def test_a_consequential_or_unknown_tool_is_never_retried_or_corrected(spec):
    f = Flaky(1); r = ex().recover(spec, {"order_id": "A-1", "limit": 5}, f, Failure("timeout"), verify=lambda o: True)
    assert r.terminal == "escalated" and f.calls == 0                                                            # the tool was not called even once more
    f2 = Flaky(0); r = ex().recover(spec, {"limit": "5"}, f2, Failure("invalid_arguments")); assert r.terminal == "escalated" and f2.calls == 0

def test_a_non_transient_failure_is_escalated_not_retried():
    f = Flaky(0); r = ex().recover(READ, {"order_id": "A-1", "limit": 5}, f, Failure("permission_denied")); assert r.terminal == "escalated" and f.calls == 0

def test_the_error_changing_mid_retry_stops_the_retries():
    calls = []
    def call(**kw):
        calls.append(1); raise TimeoutError("slow") if len(calls) == 1 else PermissionError("no")
    r = ex().recover(READ, {"order_id": "A-1", "limit": 5}, call, Failure("timeout")); assert r.terminal == "escalated" and len(calls) == 2

def test_argument_fixes_are_mechanical_and_validated():
    fixed, problems = fix_arguments(SCHEMA, {"order_id": " A-1 ", "limit": "5", "junk": 1}); assert fixed == {"order_id": "A-1", "limit": 5, "verbose": False} and problems == []
    assert validate(SCHEMA, fixed) == []
    f = Flaky(0); r = ex().recover(READ, {"order_id": " A-1 ", "limit": "5"}, f, Failure("invalid_arguments"), verify=lambda o: o["ok"])
    assert r.recovered and r.action == "correct_args" and r.steps[0]["fixed"]["limit"] == 5

def test_nothing_is_invented_and_amounts_are_not_changed_to_fit():
    assert fix_arguments(SCHEMA, {"limit": 5})[0] is None                                                         # missing required order_id is never guessed
    fixed, problems = fix_arguments(SCHEMA, {"order_id": "A-1", "limit": 500}); assert fixed is None and any("above 50" in p for p in problems)
    f = Flaky(0); r = ex().recover(READ, {"order_id": "A-1", "limit": 500}, f, Failure("invalid_arguments")); assert r.terminal == "escalated" and f.calls == 0
    assert fix_arguments(None, {"a": 1})[0] is None                                                               # no schema = nothing to validate a fix against

def test_arguments_that_already_pass_are_not_resent():
    f = Flaky(0); r = ex().recover(READ, {"order_id": "A-1", "limit": 5}, f, Failure("invalid_arguments")); assert r.terminal == "escalated" and f.calls == 0

# ---- end to end against the real server: events are recorded as real (simulated = False) and a block is never "recovered" ----
def test_run_level_recovery_records_real_events_and_returns_the_verified_result(world):
    g = world.mk(); state = {"n": 0}
    def flaky_lookup(order_id):
        state["n"] += 1
        if state["n"] < 3: raise TimeoutError("slow")
        return {"order_id": order_id, "status": "shipped"}
    g.register_tool("lookup_status", flaky_lookup, read_only=True)
    with g.trace("support", "where is my order") as run:
        out = run.call_tool_with_recovery("lookup_status", verify=lambda o: o["status"] == "shipped", executor=ex(), order_id="A-1")
    assert out["status"] == "shipped" and state["n"] == 3
    tid = run.trace_id; evs = world.c.get(f"/api/v1/traces/{tid}", headers={"Authorization": f"Bearer {world.admin}"}).json()["events"]
    done = [e for e in evs if e["event_type"] == "recovery_completed"]
    assert len(done) == 1 and done[0]["metadata"]["simulated"] is False and done[0]["metadata"]["verified"] is True and done[0]["metadata"]["recovered"] is True

def test_a_consequential_tool_that_fails_is_handed_to_a_person_and_not_run_again(world):
    g = world.mk(); n = {"c": 0}
    def boom(order_id, amount): n["c"] += 1; raise TimeoutError("payment gateway slow")
    g.register_tool("charge", boom, consequential=True)
    with pytest.raises(TimeoutError) as ei:
        with g.trace("billing", "charge") as run: run.call_tool_with_recovery("charge", executor=ex(), order_id="A-1", amount=5)
    assert n["c"] == 1 and ei.value.recovery.terminal == "escalated"

def test_a_policy_block_is_a_decision_not_a_failure_to_recover_from(world):
    g = world.mk()
    with g.trace("support", "refund twice") as run:
        run.call_tool_with_recovery("issue_refund", executor=ex(), order_id="A-1", amount=10)
        with pytest.raises(ToolCallBlocked): run.call_tool_with_recovery("issue_refund", executor=ex(), order_id="A-1", amount=10)
    assert len(world.calls) == 1
