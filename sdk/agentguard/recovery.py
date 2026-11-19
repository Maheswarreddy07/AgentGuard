"""Safe recovery that really runs: bounded retries, validated argument fixes, and a check that the original goal was met.

This lives in the SDK because only your code can run your tools. It follows four rules and never bends them:
  1. A consequential tool (money, messages, deletes, anything not read-only) is NEVER retried or auto-corrected. It is handed to a person.
  2. Retries are bounded (max_retries, exponential back-off, an overall time limit) and only for transient errors on read-only tools.
  3. A corrected argument set must pass the tool's declared schema. Nothing is invented: a missing required value is never guessed.
  4. A recovery only counts as "recovered" when your verify(result) says the original goal is now met. Without a verifier it is reported as unverified.
Standard library only.
"""
from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable

TRANSIENT = {"timeout", "timeouterror", "503", "429", "connection_error", "connectionerror", "temporarily_unavailable", "rate_limited"}
BAD_ARGS = {"invalid_arguments", "validation_error", "valueerror", "typeerror", "400", "422"}
_TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "object": dict, "array": list}


def validate(schema: dict | None, args: dict) -> list[str]:
    """A small JSON-Schema subset: type, required, enum, minimum, maximum, minLength, maxLength, properties, additionalProperties."""
    if not schema: return []
    errs, props = [], schema.get("properties", {})
    for k in schema.get("required", []):
        if k not in args: errs.append(f"missing required value: {k}")
    for k, v in args.items():
        sp = props.get(k)
        if sp is None:
            if schema.get("additionalProperties") is False: errs.append(f"unexpected value: {k}")
            continue
        t = sp.get("type")
        if t and (not isinstance(v, _TYPES[t]) or (t in ("integer", "number") and isinstance(v, bool)) or (t == "integer" and isinstance(v, float) and not v.is_integer())):
            errs.append(f"{k} should be a {t}"); continue
        if "enum" in sp and v not in sp["enum"]: errs.append(f"{k} must be one of {sp['enum']}")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if "minimum" in sp and v < sp["minimum"]: errs.append(f"{k} is below {sp['minimum']}")
            if "maximum" in sp and v > sp["maximum"]: errs.append(f"{k} is above {sp['maximum']}")
        if isinstance(v, str):
            if "minLength" in sp and len(v) < sp["minLength"]: errs.append(f"{k} is too short")
            if "maxLength" in sp and len(v) > sp["maxLength"]: errs.append(f"{k} is too long")
    return errs


def fix_arguments(schema: dict | None, args: dict) -> tuple[dict | None, list[str]]:
    """Only mechanical repairs: trim text, turn "12" into 12 / "true" into True where the schema says so, drop values the schema forbids,
    apply declared defaults. Never fills a missing required value and never changes an amount to make it fit. Returns (fixed or None, remaining problems)."""
    if not schema: return None, ["no schema is declared for this tool, so there is nothing to check a fix against"]
    props, fixed = schema.get("properties", {}), {}
    for k, v in args.items():
        sp = props.get(k)
        if sp is None:
            if schema.get("additionalProperties") is False: continue
            fixed[k] = v; continue
        t = sp.get("type")
        if isinstance(v, str):
            v = v.strip()
            try:
                if t == "integer": v = int(v)
                elif t == "number": v = float(v)
                elif t == "boolean" and v.lower() in ("true", "false"): v = v.lower() == "true"
            except ValueError: pass
        elif t == "integer" and isinstance(v, float) and v.is_integer(): v = int(v)
        fixed[k] = v
    for k, sp in props.items():
        if k not in fixed and "default" in sp: fixed[k] = sp["default"]
    problems = validate(schema, fixed)
    return (fixed, []) if not problems else (None, problems)


@dataclass
class Failure:
    error_type: str = ""
    message: str = ""


@dataclass
class ToolSpec:
    name: str
    read_only: bool = False
    consequential: bool = False
    schema: dict | None = None


@dataclass
class Report:
    action: str                      # none | retry | correct_args | escalate | stop
    terminal: str                    # recovered | unverified | escalated | failed
    reason: str
    attempts: int = 0
    verified: bool = False
    result: Any = None
    steps: list[dict] = field(default_factory=list)

    @property
    def recovered(self) -> bool: return self.terminal == "recovered"


def _etype(e: BaseException) -> str:
    return str(getattr(e, "error_type", None) or type(e).__name__).lower()


class RecoveryExecutor:
    def __init__(self, max_retries: int = 3, base_delay: float = 0.5, max_delay: float = 8.0, time_limit: float = 30.0, sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic, jitter: Callable[[], float] = random.random):
        if not 0 <= max_retries <= 10: raise ValueError("max_retries must be between 0 and 10")
        self.max_retries, self.base, self.cap, self.limit, self.sleep, self.clock, self.jitter = max_retries, base_delay, max_delay, time_limit, sleep, clock, jitter

    def recover(self, spec: ToolSpec, args: dict, call: Callable[..., Any], failure: Failure, verify: Callable[[Any], bool] | None = None) -> Report:
        et = (failure.error_type or "").lower()
        if spec.consequential or not spec.read_only:
            return Report("escalate", "escalated", "This action changes something outside the agent, so it will not be retried or changed automatically. A person must decide.")
        if et in TRANSIENT: return self._retry(spec, args, call, verify)
        if et in BAD_ARGS: return self._correct(spec, args, call, verify)
        return Report("escalate", "escalated", "This kind of failure cannot be fixed safely by trying again. A person should look at it.")

    # ---- bounded retry (read-only tools, transient errors only) ----
    def _retry(self, spec, args, call, verify) -> Report:
        start, steps = self.clock(), []
        for n in range(1, self.max_retries + 1):
            delay = min(self.cap, self.base * 2 ** (n - 1)) * (0.5 + self.jitter() / 2)
            if self.clock() - start + delay > self.limit:
                return Report("retry", "failed", f"Stopped after {n - 1} tries: the time limit of {self.limit:g}s would be exceeded.", n - 1, steps=steps)
            self.sleep(delay)
            try: out = call(**args)
            except Exception as e:
                steps.append({"attempt": n, "ok": False, "error_type": _etype(e), "waited": round(delay, 3)})
                if _etype(e) not in TRANSIENT: return Report("escalate", "escalated", "The error changed to one that retrying cannot fix.", n, steps=steps)
                continue
            steps.append({"attempt": n, "ok": True, "waited": round(delay, 3)})
            return self._verified("retry", n, out, verify, steps)
        return Report("retry", "failed", f"Still failing after {self.max_retries} tries, so recovery stopped.", self.max_retries, steps=steps)

    # ---- validated argument fix (read-only tools, one attempt) ----
    def _correct(self, spec, args, call, verify) -> Report:
        if spec.schema and not validate(spec.schema, args): return Report("escalate", "escalated", "The arguments already match the tool's rules, so changing them would not help.")
        fixed, problems = fix_arguments(spec.schema, args)
        if fixed is None: return Report("escalate", "escalated", "The arguments could not be corrected safely: " + "; ".join(problems) + ".")
        if fixed == args: return Report("escalate", "escalated", "The arguments already match the tool's rules, so changing them would not help.")
        try: out = call(**fixed)
        except Exception as e: return Report("correct_args", "failed", "The corrected call failed too.", 1, steps=[{"attempt": 1, "ok": False, "error_type": _etype(e), "fixed": fixed}])
        return self._verified("correct_args", 1, out, verify, [{"attempt": 1, "ok": True, "fixed": fixed}])

    def _verified(self, action, attempts, out, verify, steps) -> Report:
        if verify is None: return Report(action, "unverified", "The call worked, but nothing checked that the original goal was met, so this is not counted as recovered.", attempts, False, out, steps)
        try: ok = bool(verify(out))
        except Exception as e: return Report(action, "unverified", f"The goal check itself failed ({type(e).__name__}), so this is not counted as recovered.", attempts, False, out, steps)
        return Report(action, "recovered" if ok else "failed", "The call worked and the original goal was confirmed." if ok else "The call worked but the original goal was not met.", attempts, ok, out, steps)
