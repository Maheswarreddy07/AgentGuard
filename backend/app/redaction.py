import re
from typing import Any
SENSITIVE_KEYS = re.compile(r"(pass(word)?|secret|token|api[_-]?key|authorization|credential|ssn)", re.I)
PATTERNS = [(re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[REDACTED_EMAIL]"),
            (re.compile(r"\b(sk|pk|ghp|xox[bp])[-_][A-Za-z0-9_-]{12,}"), "[REDACTED_KEY]"),
            (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_SSN]")]
MAX_STR = 2000

def redact(v: Any, key: str = "") -> Any:
    if key and SENSITIVE_KEYS.search(key):
        return "[REDACTED]"
    if isinstance(v, dict):
        return {k: redact(x, str(k)) for k, x in v.items()}
    if isinstance(v, list):
        return [redact(x) for x in v[:200]]
    if isinstance(v, str):
        for pat, rep in PATTERNS:
            v = pat.sub(rep, v)
        return v if len(v) <= MAX_STR else v[:MAX_STR] + "…[TRUNCATED]"
    return v
