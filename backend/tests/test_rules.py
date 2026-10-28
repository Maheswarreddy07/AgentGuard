from datetime import datetime, timezone
from app.detectors.rules import run_all
from app.schemas.events import Event, EventType, Status
from app.schemas.findings import Category

def ev(i, t, **kw):
    return Event(trace_id="t", run_id="r", event_id=f"e{i}", agent_name="a", event_type=t,
                 timestamp=datetime(2026,1,1,tzinfo=timezone.utc), step_index=i, **kw)

def cats(events): return {f.category for f in run_all(events)}

def test_clean_run_no_findings():
    assert run_all([ev(0, EventType.RUN_START), ev(1, EventType.RUN_END)]) == []

def test_tool_failure():
    es = [ev(0, EventType.RUN_START), ev(1, EventType.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="timeout"), ev(2, EventType.RUN_END)]
    assert cats(es) == {Category.TOOL_FAILURE}

def test_retry_loop():
    es = [ev(i, EventType.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="500") for i in range(3)] + [ev(3, EventType.RUN_END)]
    assert Category.RETRY_LOOP in cats(es)

def test_unauthorized_and_approved():
    call = ev(0, EventType.TOOL_CALL, tool_name="refund", metadata={"consequential": True})
    end = ev(2, EventType.RUN_END)
    assert Category.UNAUTHORIZED in cats([call, end])
    call2 = ev(2, EventType.TOOL_CALL, tool_name="refund", metadata={"consequential": True})
    ok = ev(1, EventType.HUMAN_APPROVAL, metadata={"approved": True, "approves_tool": "refund"})
    assert Category.UNAUTHORIZED not in cats([ok, call2, ev(3, EventType.RUN_END)])
    late = ev(3, EventType.HUMAN_APPROVAL, metadata={"approved": True, "approves_tool": "refund"})
    assert Category.UNAUTHORIZED in cats([call, late, ev(4, EventType.RUN_END)])

def test_incomplete():
    assert cats([ev(0, EventType.RUN_START)]) == {Category.INCOMPLETE}
