"""Turn a real failure into a regression test, without carrying the real content along.

What is kept: the shape of the run (event types, order, tool names, statuses, error types, numbers, true/false flags, which values repeat).
What is removed: every piece of text a customer or user could have written (tool inputs, outputs, messages). Each distinct text becomes a stable
placeholder ("value-1"), so "the same refund sent twice" still looks like the same call twice. A person must review and confirm before it is saved.
"""
from __future__ import annotations

import re
from typing import Any

_KEEP_META_STRINGS = {"tool", "approves_tool", "action", "field", "op", "type", "environment", "mode", "source", "kind"}   # structural, never free text
_DROP_META = re.compile(r"(error|message|reason|approver|decided_by|note|task|prompt|content|text|email|user|name)", re.I)
_EVENT_KEYS = ("event_id", "step_index", "event_type", "tool_name", "status", "error_type", "duration_ms", "tokens_in", "tokens_out")


class Placeholders:
    def __init__(self): self.seen: dict[str, str] = {}
    def __call__(self, s: str) -> str: return self.seen.setdefault(s, f"value-{len(self.seen) + 1}")


def _scrub(v: Any, ph: Placeholders) -> Any:
    if isinstance(v, str): return ph(v)
    if isinstance(v, dict): return {k: _scrub(x, ph) for k, x in v.items()}
    if isinstance(v, list): return [_scrub(x, ph) for x in v[:50]]
    return v                                                    # numbers, booleans and null carry no text


def _meta(m: dict, ph: Placeholders) -> dict:
    out = {}
    for k, v in (m or {}).items():
        if _DROP_META.search(k) and k not in _KEEP_META_STRINGS: continue
        if isinstance(v, str): out[k] = v if k in _KEEP_META_STRINGS else ph(v)
        elif isinstance(v, (dict, list)): out[k] = _scrub(v, ph) if k not in ("must_precede", "required_tools", "constraints") else v      # rule metadata names tools and limits, not people
        else: out[k] = v
    return out


def scrub_events(payloads: list[dict]) -> list[dict]:
    """Stored event payloads (already passed through secret redaction at ingest) -> scenario events with no free text."""
    ph, out = Placeholders(), []
    for p in sorted(payloads, key=lambda e: e["step_index"]):
        e = {k: p[k] for k in _EVENT_KEYS if p.get(k) is not None}
        if p.get("tool_input") is not None: e["tool_input"] = _scrub(p["tool_input"], ph)
        if p.get("tool_output") is not None: e["tool_output"] = _scrub(p["tool_output"], ph)
        meta = _meta(p.get("metadata") or {}, ph)
        if meta: e["metadata"] = meta
        out.append(e)
    return out


def safe_id(trace_id: str) -> str:
    return "prod-" + (re.sub(r"[^A-Za-z0-9_.-]", "-", trace_id)[:60] or "run")
