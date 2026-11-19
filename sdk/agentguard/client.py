"""AgentGuard SDK: framework-independent tracing + pre-execution policy enforcement.

    guard = AgentGuard(api_url="http://localhost:8000", api_key="ag_...", mode="enforce")

    @guard.tool("issue_refund", consequential=True)
    def issue_refund(order_id, amount): ...

    with guard.trace(agent_name="support", task="Refund ORD-1") as run:
        run.tools.issue_refund(order_id="ORD-1", amount=20)     # checked BEFORE it runs; raises ToolCallBlocked if forbidden
        run.finish(claimed_success=True)
"""
import contextvars, logging, time, uuid
from datetime import datetime, timezone
from typing import Any, Callable
from agentguard.recovery import Failure, RecoveryExecutor, ToolSpec, _etype
from agentguard.errors import AgentGuardError, AgentGuardUnavailable, ApprovalRejected, ApprovalTimeout, ToolCallBlocked
from agentguard.transport import HttpTransport

_current: contextvars.ContextVar = contextvars.ContextVar("agentguard_run", default=None)
MODES = ("observe", "warn", "enforce")

class _Tool:
    def __init__(self, name, fn, consequential=False, read_only=False, external=False, idempotent=False, arg_schema=None, alternatives=None, rollback=None):
        self.name, self.fn, self.consequential, self.read_only, self.external, self.idempotent, self.arg_schema = name, fn, consequential, read_only, external, idempotent, arg_schema
        self.alternatives, self.rollback = alternatives or [], rollback
    def meta(self) -> dict:
        m = {"consequential": self.consequential, "read_only": self.read_only, "external": self.external, "idempotent": self.idempotent}
        if self.arg_schema: m["arg_schema"] = self.arg_schema
        if self.alternatives: m["alternatives"] = self.alternatives
        if self.rollback: m["rollback"] = self.rollback
        return m

class AgentGuard:
    def __init__(self, api_url: str | None = None, api_key: str | None = None, mode: str = "enforce", transport: Any = None, fail_mode: str | None = None,
                 approval_timeout: float = 300.0, approval_poll_interval: float = 2.0, sleep: Callable[[float], None] = time.sleep, timeout: float = 10.0):
        if mode not in MODES: raise ValueError(f"mode must be one of {MODES}")
        self.mode, self.transport = mode, transport or HttpTransport(api_url or "http://localhost:8000", api_key, timeout)
        # If AgentGuard itself is unreachable: enforce mode refuses to run tools (fail closed); observe/warn keep the agent running (fail open).
        self.fail_mode = fail_mode or ("closed" if mode == "enforce" else "open")
        self.approval_timeout, self.poll, self.sleep, self._tools = approval_timeout, approval_poll_interval, sleep, {}

    def register_tool(self, name: str, fn: Callable, **flags) -> Callable:
        self._tools[name] = _Tool(name, fn, **flags); return fn
    def tool(self, name: str, **flags):
        return lambda fn: self.register_tool(name, fn, **flags)
    def trace(self, agent_name: str, task: str = "", **kw) -> "Run": return Run(self, agent_name, task, **kw)
    def start_trace(self, agent_name: str, task: str = "", **kw) -> "Run":
        r = Run(self, agent_name, task, **kw); r.start(); return r
    @staticmethod
    def current() -> "Run | None": return _current.get()

class ToolBox:
    def __init__(self, run: "Run"): self._run = run
    def __getattr__(self, name: str):
        if name.startswith("_"): raise AttributeError(name)
        return lambda **kw: self._run.call_tool(name, **kw)
    def call(self, name: str, **kw): return self._run.call_tool(name, **kw)

class Run:
    def __init__(self, guard: AgentGuard, agent_name: str, task: str = "", *, trace_id: str | None = None, environment: str = "production", actor_role: str | None = None,
                 required_tools: list | None = None, must_precede: list | None = None, constraints: list | None = None, budget: dict | None = None, metadata: dict | None = None):
        self.guard, self.agent_name, self.task, self.actor_role = guard, agent_name, task, actor_role
        self.trace_id = trace_id or f"run-{uuid.uuid4().hex[:12]}"
        self._start_meta = {"sdk": "agentguard-python", "task": task, "mode": guard.mode, "environment": environment, **({"required_tools": required_tools} if required_tools else {}), **({"must_precede": must_precede} if must_precede else {}),
                            **({"constraints": constraints} if constraints else {}), **({"budget": budget} if budget else {}), **(metadata or {})}
        self.step, self._buf, self._created, self._started, self._finished, self._token, self._last_tool = 0, [], False, False, False, None, None
        self.tools = ToolBox(self)

    # ---------- lifecycle ----------
    def __enter__(self):
        self.start(); self._token = _current.set(self); return self
    def __exit__(self, exc_type, exc, tb):
        try:
            if not self._finished: self.finish(claimed_success=False if exc_type else None, error=repr(exc) if exc else None)
        finally:
            if self._token is not None: _current.reset(self._token)
        return False       # never swallow the agent's own exceptions
    def start(self) -> "Run":
        if not self._started: self._started = True; self._emit("run_start", metadata=self._start_meta)
        return self
    def finish(self, claimed_success: bool | None = None, final_response: str | None = None, error: str | None = None) -> None:
        if self._finished: return
        self._finished = True; md = {k: v for k, v in {"claimed_success": claimed_success, "final_response": final_response, "error": error}.items() if v is not None}
        self._emit("run_end", metadata=md); self.flush(strict=False)
    def run_agent(self, agent: Any):
        """Run `agent(task, tools)` (or `agent.run(task, tools)`) and record how it ended. A returned str/dict is taken as the agent's own claim."""
        fn = agent if callable(agent) else agent.run
        try: out = fn(self.task, self.tools)
        except Exception as e: self.finish(claimed_success=False, error=repr(e)); raise
        if isinstance(out, dict): self.finish(claimed_success=bool(out.get("success", True)), final_response=out.get("response"))
        else: self.finish(claimed_success=True, final_response=None if out is None else str(out))
        return out

    # ---------- low-level API ----------
    def record_tool_call(self, tool_name: str, arguments: dict | None = None, **meta) -> str:
        return self._emit("tool_call", tool_name=tool_name, tool_input=arguments or {}, metadata=meta)
    def record_tool_result(self, status: str = "success", output: Any = None, tool_name: str | None = None, error_type: str | None = None, **meta) -> str:
        return self._emit("tool_result", tool_name=tool_name or self._last_tool, tool_output=output, status="ok" if status in ("success", "ok") else "error", error_type=error_type, metadata=meta)
    def record_model_call(self, tokens_in: int = 0, tokens_out: int = 0, cost_usd: float | None = None, **meta) -> str:
        return self._emit("model_request", tokens_in=tokens_in, tokens_out=tokens_out, cost_usd=cost_usd, metadata=meta)

    # ---------- the guarded call ----------
    def call_tool(self, name: str, **kwargs):
        tool = self.guard._tools.get(name)
        if tool is None: raise KeyError(f"tool “{name}” is not registered; use @guard.tool(\"{name}\")")
        self.start(); approval_id = None
        for _ in range(3):
            try: d = self._check(tool, kwargs, approval_id)
            except AgentGuardUnavailable as e:
                if self.guard.fail_mode == "closed": raise ToolCallBlocked(f"AgentGuard is unreachable and this guard fails closed ({e}); the tool was not run.")
                d = {"allowed": True, "effective": "ALLOW", "unchecked": True}
            if d.get("allowed"): break
            if d["effective"] == "REQUIRE_APPROVAL":
                aid = d["approval_request_id"]; approver = self._wait_for_approval(aid, d)
                self._emit("human_approval", metadata={"approved": True, "approves_tool": name, "approval_id": aid, "approver": approver}); approval_id = aid; continue
            raise ToolCallBlocked(d.get("reason", "blocked by policy"), d)
        else:
            raise ToolCallBlocked("Approval did not satisfy the policy.", d)
        self._emit("tool_call", tool_name=name, tool_input=kwargs, metadata=tool.meta())
        try: out = tool.fn(**kwargs)
        except Exception as e:
            self._emit("tool_result", tool_name=name, status="error", error_type=type(e).__name__, metadata={"error": str(e)[:200]}); raise
        self._emit("tool_result", tool_name=name, tool_output=out, status="ok"); return out

    def call_tool_with_recovery(self, name: str, *, verify=None, executor: RecoveryExecutor | None = None, **kwargs):
        """Call a tool; if it fails, try the safe recovery. A policy block or a refused approval is a decision, never a failure to recover from.
        Returns the result when the original goal is confirmed by verify(result); otherwise re-raises the original error (its .recovery holds the report)."""
        try: return self.call_tool(name, **kwargs)
        except (ToolCallBlocked, ApprovalRejected, ApprovalTimeout): raise
        except Exception as first:
            tool = self.guard._tools[name]
            report = (executor or RecoveryExecutor()).recover(ToolSpec(name, tool.read_only, tool.consequential, tool.arg_schema), kwargs, lambda **kw: self.call_tool(name, **kw), Failure(_etype(first), str(first)[:200]), verify)
            self._emit("recovery_attempt", tool_name=name, metadata={"simulated": False, "action": report.action, "attempts": report.attempts, "reason": report.reason})
            self._emit("recovery_completed", tool_name=name, metadata={"simulated": False, "action": report.action, "terminal": report.terminal, "recovered": report.recovered, "verified": report.verified, "attempts": report.attempts, "reason": report.reason})
            if report.recovered: return report.result
            first.recovery = report; raise

    def _check(self, tool: _Tool, kwargs: dict, approval_id: int | None) -> dict:
        self.flush(strict=self.guard.fail_mode == "closed")
        d = self.guard.transport.request("POST", "/api/v1/runtime/check", {"trace_id": self.trace_id, "agent_name": self.agent_name, "tool_name": tool.name, "arguments": kwargs, "mode": self.guard.mode,
            "consequential": tool.consequential, "read_only": tool.read_only, "actor_role": self.actor_role, "arg_schema": tool.arg_schema, "approval_id": approval_id, "step_index": self.step})
        self.step += d.get("consumed_steps", 0); self._created = True      # the server wrote its own events (policy_check, risk_detected)
        return d

    def _wait_for_approval(self, aid: int, decision: dict) -> str:
        deadline = time.monotonic() + self.guard.approval_timeout
        while True:
            a = self.guard.transport.request("GET", f"/api/v1/approvals/{aid}")
            if a["status"] == "approved": return a.get("decided_by") or "unknown"
            if a["status"] in ("rejected", "changes_requested", "expired"):
                raise ApprovalRejected(f"Approval {a['status'].replace('_', ' ')}: {a.get('decision_note') or 'no note'}", {**decision, "approval": a})
            if time.monotonic() >= deadline: raise ApprovalTimeout(f"No decision on approval #{aid} within {self.guard.approval_timeout:g}s; the tool was not run.", aid)
            self.guard.sleep(self.guard.poll)

    # ---------- event plumbing ----------
    def _emit(self, event_type: str, **kw) -> str:
        eid = f"{self.trace_id}-e{self.step}"
        ev = {"trace_id": self.trace_id, "run_id": self.trace_id, "event_id": eid, "agent_name": self.agent_name, "event_type": event_type, "timestamp": datetime.now(timezone.utc).isoformat(), "step_index": self.step}
        ev.update({k: v for k, v in kw.items() if v is not None}); self._buf.append(ev)
        if event_type == "tool_call": self._last_tool = kw.get("tool_name")
        self.step += 1
        return eid
    def flush(self, strict: bool = True) -> None:
        if not self._buf: return
        try:
            if self._created: self.guard.transport.request("POST", f"/api/v1/traces/{self.trace_id}/events", {"events": self._buf})
            else: self.guard.transport.request("POST", "/api/v1/traces", {"trace_id": self.trace_id, "events": self._buf}); self._created = True
            self._buf = []
        except AgentGuardUnavailable:
            if strict: raise                       # enforce mode must not run tools it cannot check
        except AgentGuardError as e:
            if strict: raise                       # a rejected key/request is a configuration error: say so
            logging.getLogger("agentguard").warning("AgentGuard rejected events (%s); the agent continues unmonitored", e)
