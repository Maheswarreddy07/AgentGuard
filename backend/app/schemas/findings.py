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

class Severity(StrEnum):
    LOW = "low"; MEDIUM = "medium"; HIGH = "high"; CRITICAL = "critical"

class Finding(BaseModel):
    category: Category
    severity: Severity
    evidence_event_ids: list[str]
    explanation: str
    deterministic: bool = True
    origin_event_id: str | None = None      # where the problem was introduced, if the rule can tell
    detectable_event_id: str | None = None  # earliest event at which this condition is observable (default: first evidence)
    recommended_action: str
