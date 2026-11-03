class AgentGuardError(Exception):
    """The AgentGuard server rejected a request (bad key, validation, ...)."""
    def __init__(self, status: int, message: str): super().__init__(f"{status}: {message}"); self.status, self.message = status, message

class AgentGuardUnavailable(Exception):
    """The server could not be reached or failed (network, timeout, 5xx)."""

class ToolCallBlocked(Exception):
    """A policy forbade this tool call. The tool function was NOT executed."""
    def __init__(self, reason: str, decision: dict | None = None): super().__init__(reason); self.reason, self.decision = reason, decision or {}

class ApprovalRejected(ToolCallBlocked):
    """A human rejected (or asked for changes to) the action, or the request expired. The tool was NOT executed."""

class ApprovalTimeout(ToolCallBlocked):
    """Nobody decided within `approval_timeout`. The tool was NOT executed; the request stays pending on the server."""
    def __init__(self, reason: str, approval_id: int): super().__init__(reason, {"approval_request_id": approval_id}); self.approval_id = approval_id
