from app.detectors.rules import run_all
from app.schemas.events import EventType as T, Status
from tests.test_rules import ev, cats
from app.schemas.findings import Category as C

def test_invalid_args():
    sch = {"required": ["order_id"], "types": {"order_id": "integer"}}
    assert C.INVALID_ARGS in cats([ev(0, T.TOOL_CALL, tool_name="get", tool_input={"order_id": "x"}, metadata={"arg_schema": sch}), ev(1, T.RUN_END)])
    assert C.INVALID_ARGS not in cats([ev(0, T.TOOL_CALL, tool_name="get", tool_input={"order_id": 3}, metadata={"arg_schema": sch}), ev(1, T.RUN_END)])

def test_contradiction():
    a = ev(0, T.TOOL_RESULT, tool_name="g", tool_output={"status": "paid"}, metadata={"entity": "o1"})
    b = ev(1, T.TOOL_RESULT, tool_name="g", tool_output={"status": "unpaid"}, metadata={"entity": "o1"})
    assert C.CONTRADICTION in cats([a, b, ev(2, T.RUN_END)])
    b2 = ev(1, T.TOOL_RESULT, tool_name="g", tool_output={"status": "paid"}, metadata={"entity": "o1"})
    assert C.CONTRADICTION not in cats([a, b2, ev(2, T.RUN_END)])

def test_missing_evidence():
    s = ev(0, T.RUN_START, metadata={"required_tools": ["lookup"]})
    assert C.MISSING_EVIDENCE in cats([s, ev(1, T.RUN_END)])
    ok = ev(1, T.TOOL_RESULT, tool_name="lookup")
    assert C.MISSING_EVIDENCE not in cats([s, ok, ev(2, T.RUN_END)])

def test_workflow_invariant():
    s = ev(0, T.RUN_START, metadata={"must_precede": [["verify", "refund"]]})
    assert C.WORKFLOW in cats([s, ev(1, T.TOOL_CALL, tool_name="refund"), ev(2, T.RUN_END)])
    good = [s, ev(1, T.TOOL_RESULT, tool_name="verify"), ev(2, T.TOOL_CALL, tool_name="refund"), ev(3, T.RUN_END)]
    assert C.WORKFLOW not in cats(good)

def test_goal_constraint():
    s = ev(0, T.RUN_START, metadata={"constraints": [{"tool": "refund", "field": "amount", "max": 100}]})
    assert C.GOAL_CONSTRAINT in cats([s, ev(1, T.TOOL_CALL, tool_name="refund", tool_input={"amount": 500}), ev(2, T.RUN_END)])
    assert C.GOAL_CONSTRAINT not in cats([s, ev(1, T.TOOL_CALL, tool_name="refund", tool_input={"amount": 50}), ev(2, T.RUN_END)])

def test_unsupported_success_only_when_unresolved():
    err = ev(1, T.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="e")
    end = ev(3, T.RUN_END, metadata={"claimed_success": True})
    assert C.UNSUPPORTED_SUCCESS in cats([ev(0, T.RUN_START), err, end])
    fixed = ev(2, T.TOOL_RESULT, tool_name="x")
    assert C.UNSUPPORTED_SUCCESS not in cats([ev(0, T.RUN_START), err, fixed, end])
