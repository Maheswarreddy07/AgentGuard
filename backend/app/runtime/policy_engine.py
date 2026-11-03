"""Runtime policy engine: pure, deterministic, explainable. No DB and no LLM: the same inputs always give the same decision."""
import json, re
from dataclasses import dataclass, field
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator
from app.detectors.scanners import scan_sensitive
from app.schemas.events import Event, EventType, Status

Action = Literal["ALLOW", "WARN", "DEFER", "REQUIRE_APPROVAL", "BLOCK"]
PRECEDENCE = {"ALLOW": 0, "WARN": 1, "DEFER": 2, "REQUIRE_APPROVAL": 3, "BLOCK": 4}
Severity = Literal["info", "low", "medium", "high", "critical"]
CATEGORIES = ["workflow_invariant", "approval", "execution_budget", "permission", "data_access", "allowlist", "denylist", "sensitive_data", "custom"]
CondType = Literal["tool_denylist", "tool_allowlist", "argument_compare", "tool_call_count_above", "duplicate_call", "requires_prior", "missing_approval", "budget_exceeded", "sensitive_in_arguments", "actor_role_not_in"]
OPS = ("gt", "gte", "lt", "lte", "eq", "ne", "in", "not_in", "contains", "regex")

class Scope(BaseModel):
    agents: list[str] = Field(default_factory=lambda: ["*"]); tools: list[str] = Field(default_factory=lambda: ["*"])

class Condition(BaseModel):
    type: CondType
    tools: list[str] | None = None            # allowlist / denylist
    field: str | None = None; op: Literal[OPS] | None = None; value: Any = None   # argument_compare
    limit: float | None = None                # tool_call_count_above / budget_exceeded
    tool: str | None = None                   # tool_call_count_above (optional), requires_prior (the prior tool)
    metric: Literal["tool_calls", "steps", "tokens", "cost_usd", "duration_ms"] | None = None
    types: list[str] | None = None            # sensitive_in_arguments (empty = any)
    roles: list[str] | None = None            # actor_role_not_in

    @model_validator(mode="after")
    def _required(self):
        need = {"tool_denylist": ["tools"], "tool_allowlist": ["tools"], "argument_compare": ["field", "op"], "tool_call_count_above": ["limit"], "requires_prior": ["tool"],
                "budget_exceeded": ["metric", "limit"], "actor_role_not_in": ["roles"]}.get(self.type, [])
        miss = [n for n in need if getattr(self, n) in (None, [])]
        if miss: raise ValueError(f"condition “{self.type}” needs: {', '.join(miss)}")
        if self.type == "argument_compare" and self.op == "regex":
            try: re.compile(str(self.value))
            except re.error as e: raise ValueError(f"invalid regular expression: {e}")
        if self.type == "argument_compare" and self.op in ("in", "not_in") and not isinstance(self.value, list): raise ValueError("“in”/“not_in” need a list value")
        return self

class PolicyDef(BaseModel):
    scope: Scope = Field(default_factory=Scope)
    condition: Condition
    action: Action
    severity: Severity = "medium"
    message: str = Field(default="", max_length=300)

@dataclass
class Context:
    agent: str; tool: str; args: dict; consequential: bool = False; read_only: bool = False; actor_role: str | None = None
    history: list[Event] = field(default_factory=list); approval_ok: bool = False

@dataclass
class Match:
    policy_id: int; name: str; version: int; action: str; severity: str; explanation: str; matched: bool; satisfied_by_approval: bool = False
    def dump(self): return {"policy_id": self.policy_id, "name": self.name, "version": self.version, "action": self.action, "severity": self.severity, "explanation": self.explanation, "matched": self.matched, "satisfied_by_approval": self.satisfied_by_approval}

def _canon(a): return json.dumps(a or {}, sort_keys=True, default=str)
def _in_scope(sc: Scope, ctx: Context) -> bool:
    return ("*" in sc.agents or ctx.agent in sc.agents) and ("*" in sc.tools or ctx.tool in sc.tools)

def _get(args: dict, path: str):
    cur: Any = args
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur: return None, False
        cur = cur[part]
    return cur, True

def _compare(v, op, ref) -> bool:
    try:
        return {"gt": lambda: v > ref, "gte": lambda: v >= ref, "lt": lambda: v < ref, "lte": lambda: v <= ref, "eq": lambda: v == ref, "ne": lambda: v != ref,
                "in": lambda: v in ref, "not_in": lambda: v not in ref, "contains": lambda: ref in v, "regex": lambda: re.search(str(ref), str(v)) is not None}[op]()
    except TypeError:
        return False

def _metric(ctx: Context, m: str) -> float:
    h = ctx.history
    return {"tool_calls": sum(e.event_type == EventType.TOOL_CALL for e in h) + 1, "steps": len(h) + 1, "tokens": sum((e.tokens_in or 0) + (e.tokens_out or 0) for e in h),
            "cost_usd": sum(e.cost_usd or 0 for e in h), "duration_ms": (h[-1].timestamp - h[0].timestamp).total_seconds() * 1000 if len(h) > 1 else 0}[m]

def evaluate_condition(c: Condition, ctx: Context) -> tuple[bool, str]:
    """Returns (matched, plain-English reason). The reason is always produced so every decision can be explained."""
    t = c.type
    if t == "tool_denylist": return ctx.tool in (c.tools or []), f"“{ctx.tool}” is on the deny list" if ctx.tool in (c.tools or []) else "tool is not on the deny list"
    if t == "tool_allowlist": ok = ctx.tool in (c.tools or []); return (not ok), f"“{ctx.tool}” is not on the allow list" if not ok else "tool is on the allow list"
    if t == "argument_compare":
        v, found = _get(ctx.args, c.field or "")
        if not found: return False, f"argument “{c.field}” was not provided"
        hit = _compare(v, c.op, c.value); return hit, f"{c.field} = {v!r} {'meets' if hit else 'does not meet'} the rule ({c.op} {c.value!r})"
    if t == "tool_call_count_above":
        n = sum(e.event_type == EventType.TOOL_CALL and (not c.tool or e.tool_name == c.tool) for e in ctx.history) + 1
        return n > (c.limit or 0), f"this would be call #{n}{' to ' + c.tool if c.tool else ''}; the limit is {int(c.limit or 0)}"
    if t == "duplicate_call":
        sig = _canon(ctx.args); calls = [e for e in ctx.history if e.event_type == EventType.TOOL_CALL and e.tool_name == ctx.tool and _canon(e.tool_input) == sig]
        done = any(r.event_type == EventType.TOOL_RESULT and r.tool_name == ctx.tool and r.status == Status.OK and any(r.step_index > k.step_index for k in calls) for r in ctx.history)
        return (bool(calls) and done), "an identical call already succeeded earlier in this run" if (calls and done) else "no identical successful call earlier in this run"
    if t == "requires_prior":
        ok = any(r.event_type == EventType.TOOL_RESULT and r.tool_name == c.tool and r.status == Status.OK for r in ctx.history)
        return (not ok), f"“{c.tool}” has not succeeded yet in this run" if not ok else f"“{c.tool}” already succeeded"
    if t == "missing_approval":
        need = ctx.consequential and not ctx.approval_ok
        return need, "this is a consequential action and no valid human approval is attached" if need else ("action is not consequential" if not ctx.consequential else "a valid human approval is attached")
    if t == "budget_exceeded":
        v = _metric(ctx, c.metric or "tool_calls"); return v > (c.limit or 0), f"{(c.metric or '').replace('_', ' ')} would be {v:.4g}; the limit is {c.limit:g}"
    if t == "sensitive_in_arguments":
        found = scan_sensitive(ctx.args); hit = [x for x in found if not c.types or x in c.types]
        return bool(hit), f"arguments contain sensitive data ({', '.join(hit)})" if hit else "no sensitive data in arguments"
    if t == "actor_role_not_in": ok = (ctx.actor_role or "") in (c.roles or []); return (not ok), f"the acting role “{ctx.actor_role or 'unknown'}” is not one of: {', '.join(c.roles or [])}" if not ok else "acting role is permitted"
    return False, "unknown condition"

def evaluate_policy(pid: int, name: str, version: int, d: PolicyDef, ctx: Context) -> Match | None:
    if not _in_scope(d.scope, ctx): return None
    hit, why = evaluate_condition(d.condition, ctx)
    sat = bool(hit and d.action == "REQUIRE_APPROVAL" and ctx.approval_ok)       # a valid approval satisfies approval policies, never BLOCK
    msg = (d.message + " — " if d.message else "") + why
    return Match(pid, name, version, d.action, d.severity, msg, hit, sat)

@dataclass
class Decision:
    raw: str; effective: str; mode: str; matches: list[Match]; evaluated: list[Match]
    def reason(self) -> str:
        m = [x for x in self.matches if not x.satisfied_by_approval]
        if not m: return "No policy objected." if not self.matches else "A human approval satisfied the approval policy."
        return "; ".join(f"[{x.name}] {x.explanation}" for x in sorted(m, key=lambda x: -PRECEDENCE[x.action]))

def decide(policies: list[tuple[int, str, int, PolicyDef]], ctx: Context, mode: str = "enforce") -> Decision:
    ev = [m for m in (evaluate_policy(i, n, v, d, ctx) for i, n, v, d in policies) if m is not None]
    hits = [m for m in ev if m.matched]
    live = [m for m in hits if not m.satisfied_by_approval]
    raw = max((m.action for m in live), key=lambda a: PRECEDENCE[a], default="ALLOW")
    if mode == "observe": eff = "ALLOW"
    elif mode == "warn": eff = "ALLOW" if raw == "ALLOW" else "WARN"
    else: eff = raw
    return Decision(raw, eff, mode, hits, ev)

CONDITION_SPECS = {
    "tool_denylist": {"label": "The tool is on a list", "help": "Matches when the agent tries to use any of these tools.", "fields": [{"name": "tools", "label": "Tools", "kind": "list", "help": "Comma-separated tool names"}]},
    "tool_allowlist": {"label": "The tool is NOT on an allow list", "help": "Matches when the agent tries to use a tool that is not in this list.", "fields": [{"name": "tools", "label": "Allowed tools", "kind": "list", "help": "Comma-separated tool names"}]},
    "argument_compare": {"label": "An argument has a certain value", "help": "Matches when one input of the tool call meets a rule, e.g. amount is greater than 100.", "fields": [
        {"name": "field", "label": "Argument name", "kind": "text", "help": "Use dots for nested values, e.g. customer.tier"}, {"name": "op", "label": "Operator", "kind": "select", "options": list(OPS)},
        {"name": "value", "label": "Value", "kind": "value", "help": "A number, text, or a JSON list for in / not_in"}]},
    "tool_call_count_above": {"label": "Too many tool calls", "help": "Matches when this call would exceed a call limit.", "fields": [{"name": "limit", "label": "Limit", "kind": "number"}, {"name": "tool", "label": "Only count this tool (optional)", "kind": "text"}]},
    "duplicate_call": {"label": "The exact same call already succeeded", "help": "Matches when an identical call (same tool, same arguments) already succeeded earlier in this run.", "fields": []},
    "requires_prior": {"label": "A required earlier step has not happened", "help": "Matches when this tool is called before another tool has succeeded.", "fields": [{"name": "tool", "label": "Tool that must succeed first", "kind": "text"}]},
    "missing_approval": {"label": "A consequential action has no human approval", "help": "Matches when the call is marked consequential and no valid approval is attached.", "fields": []},
    "budget_exceeded": {"label": "A budget would be exceeded", "help": "Matches when this call would push the run over a limit.", "fields": [
        {"name": "metric", "label": "What is limited", "kind": "select", "options": ["tool_calls", "steps", "tokens", "cost_usd", "duration_ms"]}, {"name": "limit", "label": "Limit", "kind": "number"}]},
    "sensitive_in_arguments": {"label": "The arguments contain sensitive data", "help": "Matches when the inputs include personal or secret data (email, ssn, card_number, secret_key).", "fields": [{"name": "types", "label": "Only these types (empty = any)", "kind": "list"}]},
    "actor_role_not_in": {"label": "The acting role is not allowed", "help": "Matches when the run's actor role is not one of these.", "fields": [{"name": "roles", "label": "Allowed roles", "kind": "list"}]},
}

TEMPLATES = [
    {"name": "prevent_duplicate_refunds", "category": "workflow_invariant", "description": "Never repeat a refund that already succeeded in this run.",
     "definition": {"scope": {"agents": ["*"], "tools": ["issue_refund"]}, "condition": {"type": "duplicate_call"}, "action": "BLOCK", "severity": "critical", "message": "Duplicate refund"}},
    {"name": "require_approval_for_large_refunds", "category": "approval", "description": "Refunds above a limit need a human to approve them first.",
     "definition": {"scope": {"agents": ["*"], "tools": ["issue_refund"]}, "condition": {"type": "argument_compare", "field": "amount", "op": "gt", "value": 100}, "action": "REQUIRE_APPROVAL", "severity": "high", "message": "Large refund"}},
    {"name": "require_approval_for_consequential_actions", "category": "approval", "description": "Any action marked consequential needs a human approval.",
     "definition": {"scope": {"agents": ["*"], "tools": ["*"]}, "condition": {"type": "missing_approval"}, "action": "REQUIRE_APPROVAL", "severity": "high", "message": "Consequential action"}},
    {"name": "maximum_tool_calls", "category": "execution_budget", "description": "Stop a run that makes too many tool calls.",
     "definition": {"scope": {"agents": ["*"], "tools": ["*"]}, "condition": {"type": "tool_call_count_above", "limit": 25}, "action": "BLOCK", "severity": "high", "message": "Tool-call budget"}},
    {"name": "no_sensitive_data_in_outbound_messages", "category": "sensitive_data", "description": "Block outbound messages that contain personal or secret data.",
     "definition": {"scope": {"agents": ["*"], "tools": ["send_email"]}, "condition": {"type": "sensitive_in_arguments", "types": []}, "action": "BLOCK", "severity": "high", "message": "Sensitive data in message"}},
    {"name": "refunds_need_verified_customer", "category": "workflow_invariant", "description": "A refund may only happen after the customer was verified.",
     "definition": {"scope": {"agents": ["*"], "tools": ["issue_refund"]}, "condition": {"type": "requires_prior", "tool": "verify_customer"}, "action": "BLOCK", "severity": "high", "message": "Customer not verified"}},
]
