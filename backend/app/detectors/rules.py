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
    return [Finding(category=Category.RETRY_LOOP, severity=Severity.HIGH, evidence_event_ids=ids, detectable_event_id=ids[threshold - 1],
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

# ---------------------------------------------------------------------------------------------
# Behaviour detectors
# ---------------------------------------------------------------------------------------------
import difflib, json as _json

def _canon(args) -> str:
    return _json.dumps(args or {}, sort_keys=True, default=str)

def _sig(e: Event) -> tuple[str, str]:
    return (e.tool_name or "", _canon(e.tool_input))

def _result_for(events: list[Event], call: Event) -> Event | None:
    for e in events:
        if e.event_type == EventType.TOOL_RESULT and e.tool_name == call.tool_name and e.step_index > call.step_index:
            return e
        if e.event_type == EventType.TOOL_CALL and e.tool_name == call.tool_name and e.step_index > call.step_index:
            return None
    return None

def _near(a: dict | None, b: dict | None) -> bool:
    """Near-identical = same keys, and every differing value is long free text (>=20 chars) that is >=90% similar.
    A differing number or short string (an id, an amount) means a DIFFERENT request, never a near-duplicate."""
    a, b = a or {}, b or {}
    if set(a) != set(b): return False
    for k in a:
        if a[k] == b[k]: continue
        if not (isinstance(a[k], str) and isinstance(b[k], str) and len(a[k]) >= 20 and len(b[k]) >= 20): return False
        if difflib.SequenceMatcher(None, a[k], b[k]).ratio() < 0.9: return False
    return True

def repeated_calls(events: list[Event], threshold: int = 3) -> list[Finding]:
    """The same call (or a near-identical one, >=90% similar arguments) succeeded `threshold`+ times:
    the agent keeps re-asking for something it already has. Retries after errors are NOT counted here (see retry_loop)."""
    clusters: list[dict] = []
    for c in (e for e in events if e.event_type == EventType.TOOL_CALL):
        key = _canon(c.tool_input)
        cl = next((k for k in clusters if k["tool"] == c.tool_name and (k["key"] == key or _near(k["args"], c.tool_input))), None)
        if cl is None:
            cl = {"tool": c.tool_name, "key": key, "args": c.tool_input, "calls": [], "ok": [], "exact": True}; clusters.append(cl)
        if key != cl["key"]: cl["exact"] = False
        cl["calls"].append(c)
        r = _result_for(events, c)
        if r is not None and r.status == Status.OK: cl["ok"].append(c)
    out = []
    for cl in clusters:
        if len(cl["ok"]) >= threshold:
            det = cl["ok"][threshold - 1]
            out.append(Finding(category=Category.REPEATED_CALLS, severity=Severity.MEDIUM, evidence_event_ids=[c.event_id for c in cl["calls"]], detectable_event_id=det.event_id,
                explanation=f"'{cl['tool']}' was called {len(cl['ok'])} times with {'identical' if cl['exact'] else 'near-identical'} arguments and succeeded each time; the agent is re-asking for what it already has.",
                deterministic=cl["exact"], confidence=1.0 if cl["exact"] else 0.7, evidence=[f"{len(cl['calls'])} calls, {len(cl['ok'])} successful, arguments {'identical' if cl['exact'] else '>=90% similar'}"],
                recommended_action="stop_and_replan"))
    return out

def loop_detected(events: list[Event], cycles: int = 3) -> list[Finding]:
    """(a) a block of 2-3 distinct calls repeated `cycles` times in a row; (b) 4+ consecutive successful results that are identical although the calls differ (searching without learning anything)."""
    calls = [e for e in events if e.event_type == EventType.TOOL_CALL]; sigs = [_sig(c) for c in calls]; out = []
    for p in (2, 3):
        for i in range(0, len(sigs) - p * cycles + 1):
            block = sigs[i:i + p]
            if len(set(block)) == p and all(sigs[i + k] == block[k % p] for k in range(p * cycles)):
                span = calls[i:i + p * cycles]
                out.append(Finding(category=Category.LOOP, severity=Severity.HIGH, evidence_event_ids=[c.event_id for c in span], detectable_event_id=span[-1].event_id,
                    explanation=f"The same {p}-step sequence ({' → '.join(b[0] for b in block)}) repeated {cycles} times in a row. The agent is going in circles.",
                    confidence=1.0, evidence=[f"{p}-call cycle × {cycles}"], recommended_action="stop_and_replan"))
                break
        if out: break
    res = [e for e in events if e.event_type == EventType.TOOL_RESULT and e.status == Status.OK and e.tool_output not in (None, {}, [], "")]
    run: list[Event] = []
    for e in res:
        if run and _canon(e.tool_output) == _canon(run[-1].tool_output): run.append(e)
        else: run = [e]
        if len(run) >= 4:
            callsigs = {_sig(c) for c in calls if any(c.tool_name == r.tool_name for r in run) and run[0].step_index - 2 <= c.step_index <= e.step_index}
            if len(callsigs) > 1 and not out:
                out.append(Finding(category=Category.LOOP, severity=Severity.MEDIUM, evidence_event_ids=[r.event_id for r in run], detectable_event_id=run[3].event_id,
                    explanation="Four results in a row were identical even though the requests differed: the agent is making no progress.", deterministic=False, confidence=0.7,
                    evidence=["4 identical successful outputs for different requests"], recommended_action="stop_and_replan"))
            break
    return out

_BUDGET_LABEL = {"max_tool_calls": "tool calls", "max_steps": "steps", "max_tokens": "tokens", "max_cost_usd": "cost (USD)", "max_duration_ms": "run time (ms)"}

def resource_exhaustion(events: list[Event], _=None) -> list[Finding]:
    """RUN_START.metadata['budget'] = {max_tool_calls, max_steps, max_tokens, max_cost_usd, max_duration_ms}. Reports the first event that exceeds each limit."""
    s = _start(events); budget = (s.metadata.get("budget") if s else None) or {}
    if not budget: return []
    calls = tokens = 0; cost = 0.0; found: dict[str, Event] = {}; vals: dict[str, float] = {}
    for n, e in enumerate(events, 1):
        calls += e.event_type == EventType.TOOL_CALL; tokens += (e.tokens_in or 0) + (e.tokens_out or 0); cost += e.cost_usd or 0.0
        cur = {"max_tool_calls": calls, "max_steps": n, "max_tokens": tokens, "max_cost_usd": cost, "max_duration_ms": (e.timestamp - s.timestamp).total_seconds() * 1000}
        for k, lim in budget.items():
            if k in cur and isinstance(lim, (int, float)) and cur[k] > lim and k not in found: found[k] = e; vals[k] = cur[k]
    return [Finding(category=Category.RESOURCE, severity=Severity.HIGH, evidence_event_ids=[e.event_id], detectable_event_id=e.event_id, confidence=1.0,
            explanation=f"The run used {vals[k]:.4g} {_BUDGET_LABEL[k]}, over its limit of {budget[k]}.", evidence=[f"{k} = {budget[k]}"], recommended_action="stop_and_escalate") for k, e in found.items()]

def sensitive_exposure(events: list[Event], _=None) -> list[Finding]:
    """Sensitive data (found by the ingestion scanner) leaving through an external tool call or appearing in the final response. Seeing it in a tool RESULT is normal and not flagged."""
    out = []
    for e in events:
        types = e.metadata.get("sensitive_types")
        if not types: continue
        if e.event_type == EventType.TOOL_CALL and e.metadata.get("external"):
            where = f"sent to external tool '{e.tool_name}'"
        elif e.event_type == EventType.RUN_END:
            where = "included in the final response"
        else: continue
        out.append(Finding(category=Category.SENSITIVE, severity=Severity.HIGH, evidence_event_ids=[e.event_id], confidence=1.0,
            explanation=f"Sensitive data ({', '.join(types)}) was {where}.", evidence=[f"detected types: {', '.join(types)}"], recommended_action="block_and_request_approval"))
    return out

def injection_indicators(events: list[Event], _=None) -> list[Finding]:
    """Untrusted content (a tool result) contains instruction-like text. HIGH when the very next call uses a tool named in that text (the agent may have obeyed it)."""
    out = []; ordered = sorted(events, key=lambda e: e.step_index)
    for i, e in enumerate(ordered):
        ind = e.metadata.get("injection_indicators")
        if e.event_type != EventType.TOOL_RESULT or not ind: continue
        nxt = next((c for c in ordered[i + 1:] if c.event_type == EventType.TOOL_CALL), None)
        text = _canon(e.tool_output).lower()
        obeyed = bool(nxt and nxt.tool_name and nxt.tool_name.lower() in text)
        out.append(Finding(category=Category.INJECTION, severity=Severity.HIGH if obeyed else Severity.MEDIUM, deterministic=False, confidence=0.8 if obeyed else 0.6,
            evidence_event_ids=[e.event_id] + ([nxt.event_id] if obeyed else []), detectable_event_id=e.event_id,
            explanation=f"A tool result contains instruction-like text ({', '.join(ind)})." + (f" The next call uses '{nxt.tool_name}', which the text mentions: the agent may have followed it." if obeyed else " Treat it as untrusted data."),
            evidence=[f"patterns: {', '.join(ind)}"], recommended_action="treat_as_untrusted_and_review"))
    return out

ALL_RULES = [invalid_args, tool_failure, retry_loop, repeated_calls, loop_detected, contradiction, missing_evidence, workflow_invariant, goal_constraint,
             unsupported_success, unauthorized_action, resource_exhaustion, sensitive_exposure, injection_indicators, incomplete]
_PARAM = {retry_loop: "retry_loop_threshold", repeated_calls: "duplicate_call_threshold"}

def run_all(events: list[Event], disabled=frozenset(), retry_loop_threshold: int = 3, duplicate_call_threshold: int = 3) -> list[Finding]:
    """Run every enabled rule. `disabled` holds rule function names; thresholds are adjustable. Each finding is stamped with its rule name."""
    ordered = sorted(events, key=lambda e: e.step_index)
    params = {retry_loop: retry_loop_threshold, repeated_calls: duplicate_call_threshold}
    out: list[Finding] = []
    for rule in ALL_RULES:
        if rule.__name__ in disabled: continue
        for f in (rule(ordered, params[rule]) if rule in params else rule(ordered)):
            f.rule = f.rule or rule.__name__
            if f.confidence is None: f.confidence = 1.0 if f.deterministic else 0.6
            if not f.evidence: f.evidence = [f"events: {', '.join(f.evidence_event_ids)}"]
            out.append(f)
    return out
