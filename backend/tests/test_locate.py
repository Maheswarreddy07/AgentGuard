from app.detectors.rules import run_all
from app.localization.locate import localize
from app.schemas.events import EventType, Status
from tests.test_rules import ev

def test_no_findings_unresolved():
    es = [ev(0, EventType.RUN_START), ev(1, EventType.RUN_END)]
    assert localize(es, run_all(es)).resolved is False

def test_earliest_and_observed():
    es = [ev(0, EventType.RUN_START),
          ev(1, EventType.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="e"),
          ev(2, EventType.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="e"),
          ev(3, EventType.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="e"),
          ev(4, EventType.RUN_END)]
    loc = localize(es, run_all(es))
    assert (loc.first_detectable_event_id, loc.observed_event_id) == ("e1", "e3")
    assert loc.origin_event_id is None and "not determinable" in loc.note

def test_origin_from_parent_link():
    es = [ev(0, EventType.TOOL_CALL, tool_name="x"),
          ev(1, EventType.TOOL_RESULT, tool_name="x", status=Status.ERROR, error_type="e", parent_event_id="e0"),
          ev(2, EventType.RUN_END)]
    assert localize(es, run_all(es)).origin_event_id == "e0"

def test_contradiction_origin_vs_detectable():
    a = ev(0, EventType.TOOL_RESULT, tool_name="g", tool_output={"s": 1}, metadata={"entity": "o"})
    b = ev(1, EventType.TOOL_RESULT, tool_name="g", tool_output={"s": 2}, metadata={"entity": "o"})
    loc = localize([a, b, ev(2, EventType.RUN_END)], run_all([a, b, ev(2, EventType.RUN_END)]))
    assert (loc.origin_event_id, loc.first_detectable_event_id) == ("e0", "e1")
