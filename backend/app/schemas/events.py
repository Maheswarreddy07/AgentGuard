from __future__ import annotations
from datetime import datetime
from enum import StrEnum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

class EventType(StrEnum):
    RUN_START = "run_start"
    MODEL_REQUEST = "model_request"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    VALIDATION_FAILURE = "validation_failure"
    RECOVERY_ATTEMPT = "recovery_attempt"
    HUMAN_APPROVAL = "human_approval"
    RUN_END = "run_end"

class Status(StrEnum):
    OK = "ok"
    ERROR = "error"

class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trace_id: str
    run_id: str
    event_id: str
    parent_event_id: str | None = None
    agent_name: str
    event_type: EventType
    timestamp: datetime
    step_index: int = Field(ge=0)
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    tool_output: Any = None
    status: Status = Status.OK
    duration_ms: int | None = Field(default=None, ge=0)
    error_type: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
