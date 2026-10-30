"""Deterministic detectors. Each is a pure function: events -> findings."""
from app.schemas.events import Event, EventType, Status
from app.schemas.findings import Category, Finding, Severity

CONSEQUENTIAL_META = "consequential"

def tool_failure(events: list[Event]) -> list[Finding]:
    return [Finding(category=Category.TOOL_FAILURE, severity=Severity.MEDIUM,
            evidence_event_ids=[e.event_id],
            explanation=f"Tool '{e.tool_name}' returned an error ({e.error_type or 'unknown'}).",
            recommended_action="retry_if_transient_else_escalate")
            for e in events if e.event_type == EventType.TOOL_RESULT and e.status == Status.ERROR]

def retry_loop(events: list[Event], threshold: int = 3) -> list[Finding]:
    """Consecutive identical failures of one tool (a success of that tool resets the streak)."""
    streak: dict[str, tuple[str | None, list[str]]] = {}
    hits: dict[tuple, list[str]] = {}
    for e in events:
        if e.event_type != EventType.TOOL_RESULT:
            continue
        if e.status == Status.OK:
            streak.pop(e.tool_name, None); continue
        et, ids = streak.get(e.tool_name, (None, []))
        ids = ids + [e.event_id] if et == e.error_type else [e.event_id]
        streak[e.tool_name] = (e.error_type, ids)
        if len(ids) >= threshold:
            hits[(e.tool_name, e.error_type)] = ids
    return [Finding(category=Category.RETRY_LOOP, severity=Severity.HIGH, evidence_event_ids=ids,
            explanation=f"Tool '{k[0]}' failed {len(ids)} times in a row with the same error.", recommended_action="stop_and_escalate")
            for k, ids in hits.items()]

def unauthorized_action(events: list[Event]) -> list[Finding]:
    """A consequential call needs an earlier HUMAN_APPROVAL (approved=True) whose metadata['approves_tool'] names the tool."""
    out = []
    for e in events:
        if e.event_type != EventType.TOOL_CALL or not e.metadata.get(CONSEQUENTIAL_META):
            continue
        ok = any(a.event_type == EventType.HUMAN_APPROVAL and a.metadata.get("approved") is True
                 and a.metadata.get("approves_tool") == e.tool_name and a.step_index < e.step_index for a in events)
        if not ok:
            out.append(Finding(category=Category.UNAUTHORIZED, severity=Severity.CRITICAL, evidence_event_ids=[e.event_id],
                explanation=f"Consequential call '{e.tool_name}' ran without a prior matching human approval.",
                recommended_action="block_and_request_approval"))
    return out

def incomplete(events: list[Event]) -> list[Finding]:
    if events and not any(e.event_type == EventType.RUN_END for e in events):
        return [Finding(category=Category.INCOMPLETE, severity=Severity.LOW,
                evidence_event_ids=[events[-1].event_id],
                explanation="Trace has no run_end event; it may be abandoned or still running.",
                recommended_action="wait_or_mark_abandoned")]
    return []


_TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "object": dict, "array": list}

def invalid_args(events: list[Event]) -> list[Finding]:
    """metadata['arg_schema'] = {'required': [..], 'types': {field: 'integer'|...}}"""
    out = []
    for e in events:
        sch = e.metadata.get("arg_schema")
        if e.event_type != EventType.TOOL_CALL or not sch:
            continue
        args, problems = e.tool_input or {}, []
        problems += [f"missing '{k}'" for k in sch.get("required", []) if k not in args]
        for k, t in sch.get("types", {}).items():
            if k in args and (not isinstance(args[k], _TYPES[t]) or (t in ("integer", "number") and isinstance(args[k], bool))):
                problems.append(f"'{k}' should be {t}")
        if problems:
            out.append(Finding(category=Category.INVALID_ARGS, severity=Severity.MEDIUM,
                evidence_event_ids=[e.event_id], explanation=f"Invalid arguments for '{e.tool_name}': " + "; ".join(problems),
                recommended_action="correct_args_via_schema_then_retry_if_read_only"))
    return out

def contradiction(events: list[Event]) -> list[Finding]:
    """Two OK results for the same metadata['entity'] disagreeing on a shared field."""
    seen: dict[str, Event] = {}
    out = []
    for e in events:
        ent = e.metadata.get("entity")
        if e.event_type != EventType.TOOL_RESULT or e.status != Status.OK or not ent or not isinstance(e.tool_output, dict):
            continue
        prev = seen.get(ent)
        if prev:
            diff = [k for k in prev.tool_output if k in e.tool_output and prev.tool_output[k] != e.tool_output[k]]
            if diff:
                out.append(Finding(category=Category.CONTRADICTION, severity=Severity.HIGH,
                    evidence_event_ids=[prev.event_id, e.event_id], origin_event_id=prev.event_id, detectable_event_id=e.event_id,
                    explanation=f"Results for '{ent}' disagree on: {', '.join(diff)}.",
                    recommended_action="request_additional_evidence"))
        seen[ent] = e
    return out

def _start(events):
    return next((e for e in events if e.event_type == EventType.RUN_START), None)

def missing_evidence(events: list[Event]) -> list[Finding]:
    """RUN_START.metadata['required_tools'] must each have a successful result before run_end."""
    s, end = _start(events), next((e for e in events if e.event_type == EventType.RUN_END), None)
    if not s or not end:
        return []
    ok = {e.tool_name for e in events if e.event_type == EventType.TOOL_RESULT and e.status == Status.OK}
    miss = [t for t in s.metadata.get("required_tools", []) if t not in ok]
    return [Finding(category=Category.MISSING_EVIDENCE, severity=Severity.HIGH, evidence_event_ids=[end.event_id],
            explanation=f"Run ended without successful result from: {', '.join(miss)}.",
            recommended_action="request_additional_evidence")] if miss else []

def workflow_invariant(events: list[Event]) -> list[Finding]:
    """RUN_START.metadata['must_precede'] = [[A, B]]: B may only be called after A succeeded."""
    s = _start(events)
    out = []
    for a, b in (s.metadata.get("must_precede", []) if s else []):
        a_ok = None
        for e in events:
            if e.event_type == EventType.TOOL_RESULT and e.tool_name == a and e.status == Status.OK:
                a_ok = a_ok if a_ok is not None else e.step_index
            if e.event_type == EventType.TOOL_CALL and e.tool_name == b and (a_ok is None or a_ok > e.step_index):
                out.append(Finding(category=Category.WORKFLOW, severity=Severity.HIGH, evidence_event_ids=[e.event_id],
                    explanation=f"'{b}' was called before '{a}' succeeded.", recommended_action="stop_and_escalate"))
                break
    return out

def goal_constraint(events: list[Event]) -> list[Finding]:
    """RUN_START.metadata['constraints'] = [{'tool':..,'field':..,'max':..}]"""
    s = _start(events)
    out = []
    for c in (s.metadata.get("constraints", []) if s else []):
        for e in events:
            v = (e.tool_input or {}).get(c["field"])
            if e.event_type == EventType.TOOL_CALL and e.tool_name == c["tool"] and isinstance(v, (int, float)) and v > c["max"]:
                out.append(Finding(category=Category.GOAL_CONSTRAINT, severity=Severity.HIGH, evidence_event_ids=[e.event_id],
                    explanation=f"'{c['field']}'={v} exceeds task limit {c['max']}.", recommended_action="block_and_request_approval"))
    return out

def unsupported_success(events: list[Event]) -> list[Finding]:
    """RUN_END claims success while some tool's latest result is an unresolved error."""
    end = next((e for e in events if e.event_type == EventType.RUN_END), None)
    if not end or end.metadata.get("claimed_success") is not True:
        return []
    last: dict[str, Event] = {}
    for e in events:
        if e.event_type == EventType.TOOL_RESULT:
            last[e.tool_name] = e
    bad = [e for e in last.values() if e.status == Status.ERROR]
    return [Finding(category=Category.UNSUPPORTED_SUCCESS, severity=Severity.CRITICAL,
            evidence_event_ids=[e.event_id for e in bad] + [end.event_id],
            explanation="Run claimed success but a tool's latest result is an unresolved error.",
            recommended_action="mark_failed_and_escalate")] if bad else []

ALL_RULES = [invalid_args, tool_failure, retry_loop, contradiction, missing_evidence, workflow_invariant,
             goal_constraint, unsupported_success, unauthorized_action, incomplete]

def run_all(events: list[Event], disabled=frozenset(), retry_loop_threshold: int = 3) -> list[Finding]:
    """Run every enabled rule. `disabled` holds rule function names; the retry-loop threshold is adjustable."""
    ordered = sorted(events, key=lambda e: e.step_index)
    out: list[Finding] = []
    for rule in ALL_RULES:
        if rule.__name__ in disabled:
            continue
        out += rule(ordered, retry_loop_threshold) if rule is retry_loop else rule(ordered)
    return out
