"""Content scanners run on RAW events at ingestion (before redaction) and record only *labels* in event metadata."""
import re
from typing import Any
from app.schemas.events import Event, EventType

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_KEY = re.compile(r"\b(sk|pk|ghp|xox[bp]|ag)[-_][A-Za-z0-9_-]{12,}")
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
INJECTION_PATTERNS = {
    "ignore_instructions": re.compile(r"ignore\s+(all|any|the|your|previous|prior|above|earlier)(\s+\w+){0,2}\s+(instructions|rules|messages|guidelines|polic(y|ies))", re.I),
    "disregard_system": re.compile(r"disregard\s+(the\s+|your\s+)?(previous|prior|system|safety)", re.I),
    "role_override": re.compile(r"\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|system|developer)\b", re.I),
    "reveal_prompt": re.compile(r"(reveal|print|show|repeat)\s+(your\s+|the\s+)?(system\s+prompt|hidden\s+instructions)", re.I),
    "conceal_from_user": re.compile(r"do\s+not\s+(tell|inform|mention|alert)[^.]{0,40}(user|customer|operator)", re.I),
    "execute_command": re.compile(r"\b(run|execute|call)\s+the\s+following\b|\bnew\s+instructions?\s*:", re.I),
    "override_policy": re.compile(r"override\s+(the\s+)?(policy|policies|safety|approval)|skip\s+(the\s+)?approval", re.I),
}

def _luhn(digits: str) -> bool:
    ds = [int(c) for c in digits][::-1]
    return sum(d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2) for i, d in enumerate(ds)) % 10 == 0

def _strings(v: Any):
    if isinstance(v, str): yield v
    elif isinstance(v, dict):
        for k, x in v.items(): yield from _strings(x)
    elif isinstance(v, (list, tuple)):
        for x in v: yield from _strings(x)

def scan_sensitive(obj: Any) -> list[str]:
    found: set[str] = set()
    for t in _strings(obj):
        if _EMAIL.search(t): found.add("email")
        if _SSN.search(t): found.add("ssn")
        if _KEY.search(t): found.add("secret_key")
        for m in _CARD.finditer(t):
            d = re.sub(r"\D", "", m.group())
            if 13 <= len(d) <= 19 and _luhn(d): found.add("card_number")
    return sorted(found)

def scan_injection(obj: Any) -> list[str]:
    return sorted({n for t in _strings(obj) for n, rx in INJECTION_PATTERNS.items() if rx.search(t)})

def annotate_event(ev: Event) -> Event:
    """Return the event with scanner labels added to metadata. Labels only — never the sensitive content itself."""
    md = dict(ev.metadata or {}); content = None
    if ev.event_type == EventType.TOOL_CALL: content = ev.tool_input
    elif ev.event_type == EventType.TOOL_RESULT: content = ev.tool_output
    elif ev.event_type == EventType.RUN_END: content = md.get("final_response")
    if content is not None:
        if (s := scan_sensitive(content)): md["sensitive_types"] = s
        if ev.event_type == EventType.TOOL_RESULT and (i := scan_injection(content)): md["injection_indicators"] = i
    return ev.model_copy(update={"metadata": md}) if md != (ev.metadata or {}) else ev
