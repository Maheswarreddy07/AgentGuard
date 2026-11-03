from enum import StrEnum
from pydantic import BaseModel

class Category(StrEnum):
    INVALID_ARGS = "invalid_tool_arguments"
    TOOL_FAILURE = "tool_execution_failure"
    RETRY_LOOP = "repeated_failures"
    UNAUTHORIZED = "unauthorized_action"
    UNSUPPORTED_SUCCESS = "unsupported_success_claim"
    INCOMPLETE = "incomplete_execution"
    MISSING_EVIDENCE = "missing_required_evidence"
    CONTRADICTION = "contradictory_tool_results"
    WORKFLOW = "workflow_invariant_violation"
    GOAL_CONSTRAINT = "goal_constraint_violation"
    REPEATED_CALLS = "repeated_tool_calls"
    LOOP = "infinite_loop"
    RESOURCE = "resource_exhaustion"
    SENSITIVE = "sensitive_data_exposure"
    INJECTION = "prompt_injection_indicator"

class Severity(StrEnum):
    INFO = "info"; LOW = "low"; MEDIUM = "medium"; HIGH = "high"; CRITICAL = "critical"

class Finding(BaseModel):
    category: Category
    severity: Severity
    evidence_event_ids: list[str]
    explanation: str
    deterministic: bool = True
    rule: str = ""                      # which detector produced it
    confidence: float | None = None    # 1.0 = condition verified by a rule; <1.0 = documented heuristic strength (NOT a calibrated probability)
    evidence: list[str] = []           # human-readable evidence lines
    origin_event_id: str | None = None      # where the problem was introduced, if the rule can tell
    detectable_event_id: str | None = None  # earliest event at which this condition is observable (default: first evidence)
    recommended_action: str
