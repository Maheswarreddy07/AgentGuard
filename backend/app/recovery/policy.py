"""Recovery policy + simulated executor.

decide() uses ONLY observable trace data + detector findings (never scenario ground truth).
execute() applies a decision inside a deterministic SIMULATED environment. No live action is ever run here.
Consequential operations are never retried or auto-corrected: they always escalate to a human.
"""
from pydantic import BaseModel
from app.schemas.events import Event, EventType, Status
from app.schemas.findings import Category as C, Finding

MAX_RETRIES = 3
TRANSIENT = {"timeout", "503", "429", "connection_error"}

class Decision(BaseModel):
    action: str  # none | retry | correct_args | request_evidence | escalate | stop
    reason: str
    max_attempts: int = 0

class Outcome(BaseModel):
    attempted: bool
    recovered: bool
    attempts: int
    terminal: str  # none | recovered | escalated | stopped

def _call_before(events: list[Event], result_id: str) -> Event | None:
    res = next((e for e in events if e.event_id == result_id), None)
    if not res:
        return None
    calls = [e for e in events if e.event_type == EventType.TOOL_CALL and e.tool_name == res.tool_name and e.step_index < res.step_index]
    return calls[-1] if calls else None

def decide(events: list[Event], findings: list[Finding], max_retries: int = MAX_RETRIES) -> Decision:
    cats = {f.category for f in findings}
    if cats & {C.UNAUTHORIZED, C.WORKFLOW, C.GOAL_CONSTRAINT}:
        return Decision(action="escalate", reason="Policy/authorization violation: human approval required.")
    if cats & {C.SENSITIVE, C.INJECTION}:
        return Decision(action="escalate", reason="Sensitive data or possible prompt injection: a human must review before continuing.")
    if cats & {C.REPEATED_CALLS, C.LOOP, C.RESOURCE} and not cats & {C.RETRY_LOOP}:
        return Decision(action="stop", reason="The agent is repeating itself, going in circles or over budget; stop and replan instead of continuing.")
    if C.UNSUPPORTED_SUCCESS in cats:
        return Decision(action="escalate", reason="Success claim is unsupported; mark failed and escalate.")
    if C.RETRY_LOOP in cats:
        return Decision(action="stop", reason="Repeated identical failures; retrying further is unsafe.")
    if C.INVALID_ARGS in cats:
        f = next(f for f in findings if f.category == C.INVALID_ARGS)
        call = next((e for e in events if e.event_id == f.evidence_event_ids[0]), None)
        if call and call.metadata.get("read_only") and not call.metadata.get("consequential"):
            return Decision(action="correct_args", reason="Read-only call: correct arguments via schema and retry once.", max_attempts=1)
        return Decision(action="escalate", reason="Invalid arguments on a non-read-only tool; will not auto-correct.")
    if cats & {C.CONTRADICTION, C.MISSING_EVIDENCE}:
        return Decision(action="request_evidence", reason="Evidence is missing or contradictory; gather more before concluding.", max_attempts=1)
    if C.TOOL_FAILURE in cats:
        f = next(f for f in findings if f.category == C.TOOL_FAILURE)
        res = next(e for e in events if e.event_id == f.evidence_event_ids[0])
        call = _call_before(events, res.event_id)
        if call and call.metadata.get("read_only") and not call.metadata.get("consequential") and res.error_type in TRANSIENT:
            return Decision(action="retry", reason="Transient failure on read-only tool: bounded retry with backoff.", max_attempts=max_retries)
        return Decision(action="escalate", reason="Failure is non-transient or tool is not known read-only.")
    return Decision(action="none", reason="No actionable finding.")

def execute(decision: Decision, sim: dict, max_retries: int = MAX_RETRIES) -> Outcome:
    a = decision.action
    if a == "none":
        return Outcome(attempted=False, recovered=False, attempts=0, terminal="none")
    if a == "stop":
        return Outcome(attempted=False, recovered=False, attempts=0, terminal="stopped")
    if a == "escalate":
        return Outcome(attempted=False, recovered=False, attempts=0, terminal="escalated")
    if a == "retry":
        fails = int(sim.get("transient_fail_count", 0))
        ok = fails < max_retries
        return Outcome(attempted=True, recovered=ok, attempts=fails + 1 if ok else max_retries, terminal="recovered" if ok else "escalated")
    ok = bool(sim.get("corrected_args_valid" if a == "correct_args" else "evidence_available", False))
    return Outcome(attempted=True, recovered=ok, attempts=1, terminal="recovered" if ok else "escalated")
