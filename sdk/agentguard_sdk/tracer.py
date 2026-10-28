"""Minimal SDK. Records observable actions only (never model reasoning). Dependency-free (stdlib).

    tracer = Tracer("my-agent", transport=http_transport("http://localhost:8000"))
    with tracer.run(required_tools=["lookup"]) as run:
        out = run.call("lookup", {"order_id": 1}, fn=lookup, read_only=True)
        run.finish(claimed_success=True)
"""
import json, urllib.request, uuid
from datetime import datetime, timezone
from typing import Any, Callable

def http_transport(base_url: str, timeout: float = 5.0) -> Callable[[str, list[dict]], None]:
    def send(trace_id: str, events: list[dict]) -> None:
        req = urllib.request.Request(f"{base_url}/api/v1/traces", data=json.dumps({"trace_id": trace_id, "events": events}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=timeout).read()
    return send

class Run:
    def __init__(self, tracer: "Tracer", trace_id: str, meta: dict):
        self.t, self.trace_id, self.events, self._ended = tracer, trace_id, [], False
        self._emit("run_start", metadata=meta)

    def _emit(self, event_type: str, **kw) -> str:
        n = len(self.events)
        eid = f"e{n}"
        self.events.append({"trace_id": self.trace_id, "run_id": self.trace_id, "event_id": eid, "agent_name": self.t.agent_name,
                            "event_type": event_type, "timestamp": datetime.now(timezone.utc).isoformat(), "step_index": n, **kw})
        return eid

    def approval(self, tool_name: str, approved: bool) -> None:
        self._emit("human_approval", metadata={"approved": approved, "approves_tool": tool_name})

    def call(self, tool_name: str, args: dict[str, Any], fn: Callable[..., Any], read_only: bool = False,
             consequential: bool = False, arg_schema: dict | None = None, entity: str | None = None) -> Any:
        meta = {"read_only": read_only, "consequential": consequential}
        if arg_schema: meta["arg_schema"] = arg_schema
        cid = self._emit("tool_call", tool_name=tool_name, tool_input=args, metadata=meta)
        try:
            out = fn(**args)
        except Exception as exc:
            self._emit("tool_result", tool_name=tool_name, parent_event_id=cid, status="error", error_type=type(exc).__name__)
            raise
        self._emit("tool_result", tool_name=tool_name, parent_event_id=cid, tool_output=out, metadata={"entity": entity} if entity else {})
        return out

    def finish(self, claimed_success: bool) -> None:
        if not self._ended:
            self._emit("run_end", metadata={"claimed_success": claimed_success}); self._ended = True

class Tracer:
    def __init__(self, agent_name: str, transport: Callable[[str, list[dict]], None]):
        self.agent_name, self.transport = agent_name, transport

    def run(self, **run_meta):
        tracer = self
        class _Ctx:
            def __enter__(s):
                s.run = Run(tracer, uuid.uuid4().hex[:16], run_meta); return s.run
            def __exit__(s, *exc):
                try:  # telemetry must never break the agent
                    tracer.transport(s.run.trace_id, s.run.events)
                except Exception:
                    pass
                return False  # never swallow agent exceptions
        return _Ctx()
