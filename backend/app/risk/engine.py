"""Explainable, rule-based risk prediction. Every point of the score comes from a named signal with a stated weight.
This predicts what is *likely to go wrong next*; it is separate from confirmed findings. Not a trained model."""
import json
from dataclasses import dataclass, field
from app.schemas.events import Event, EventType, Status
from app.services.settings import Config

LEVELS = [(75, "critical"), (50, "high"), (25, "medium"), (0, "low")]
# signal name -> (weight in points, failure it predicts)
WEIGHTS = {
    "intended_violation": (60, None),   # decided per violation type below
    "failure_streak": (60, "repeated_failures"), "budget_burn": (55, "resource_exhaustion"), "duplicate_pressure": (55, "repeated_tool_calls"),
    "cycle_pattern": (55, "infinite_loop"), "unresolved_contradiction": (25, "unsupported_success_claim"), "no_progress": (50, "infinite_loop"),
    "injection_in_context": (55, "prompt_injection_indicator"), "recent_failure_rate": (15, "tool_execution_failure"), "unresolved_error": (15, "unsupported_success_claim"),
}
ACTION_FOR = {"repeated_failures": "stop", "repeated_tool_calls": "stop", "infinite_loop": "stop", "resource_exhaustion": "stop", "unauthorized_action": "escalate", "workflow_invariant_violation": "escalate",
              "goal_constraint_violation": "escalate", "invalid_tool_arguments": "correct_args", "unsupported_success_claim": "request_evidence", "contradictory_tool_results": "request_evidence",
              "prompt_injection_indicator": "escalate", "tool_execution_failure": "retry", "sensitive_data_exposure": "escalate"}

@dataclass
class Signal:
    name: str; points: float; predicts: str; detail: str
    def dump(self): return {"name": self.name, "points": round(self.points, 1), "predicts": self.predicts, "detail": self.detail}

@dataclass
class Risk:
    score: int; level: str; predicted_failure: str | None; confidence: str; evidence: list[str]; recommended_action: str; signals: list[dict] = field(default_factory=list)
    def dump(self): return {"score": self.score, "level": self.level, "predicted_failure": self.predicted_failure, "confidence": self.confidence, "evidence": self.evidence,
                            "recommended_action": self.recommended_action, "signals": self.signals}

def _canon(a): return json.dumps(a or {}, sort_keys=True, default=str)
def level_of(score: int) -> str: return next(l for m, l in LEVELS if score >= m)

def assess(events: list[Event], cfg: Config, intended: dict | None = None) -> Risk:
    """events = everything that has happened so far. intended = the call about to run:
    {tool, args, consequential, arg_schema} — lets the engine warn *before* the action executes."""
    ev = sorted(events, key=lambda e: e.step_index); sig: list[Signal] = []
    start = next((e for e in ev if e.event_type == EventType.RUN_START), None)
    calls = [e for e in ev if e.event_type == EventType.TOOL_CALL]; results = [e for e in ev if e.event_type == EventType.TOOL_RESULT]

    streak = 0
    for r in reversed(results):
        if r.status == Status.ERROR: streak += 1
        else: break
    if streak >= 2:
        sig.append(Signal("failure_streak", WEIGHTS["failure_streak"][0] * min(1, streak / cfg.retry_loop_threshold), "repeated_failures", f"the last {streak} tool results were all errors"))
    last5 = results[-5:]; errs = sum(r.status == Status.ERROR for r in last5)
    if len(last5) >= 3 and errs >= 2 and streak < 2:
        sig.append(Signal("recent_failure_rate", WEIGHTS["recent_failure_rate"][0] * errs / len(last5), "tool_execution_failure", f"{errs} of the last {len(last5)} tool results were errors"))

    counts: dict[tuple, int] = {}
    for c in calls: counts[(c.tool_name, _canon(c.tool_input))] = counts.get((c.tool_name, _canon(c.tool_input)), 0) + 1
    if intended: k = (intended["tool"], _canon(intended.get("args"))); counts[k] = counts.get(k, 0) + 1
    if counts:
        (tool, _), c = max(counts.items(), key=lambda kv: kv[1])
        ok_calls = sum(1 for call in calls if (call.tool_name, _canon(call.tool_input)) == (tool, _) and any(r.tool_name == tool and r.status == Status.OK and r.step_index > call.step_index for r in results))
        if c >= 2 and ok_calls >= 1:
            sig.append(Signal("duplicate_pressure", WEIGHTS["duplicate_pressure"][0] * min(1, (c - 1) / max(1, cfg.duplicate_call_threshold - 1)), "repeated_tool_calls", f"'{tool}' called {c} times with identical arguments, already succeeded before"))

    seq = [(c.tool_name, _canon(c.tool_input)) for c in calls] + ([(intended["tool"], _canon(intended.get("args")))] if intended else [])
    for p in (2, 3):
        if len(seq) >= 2 * p:
            reps = 1
            while len(seq) >= p * (reps + 1) and seq[-p * (reps + 1):-p * reps] == seq[-p:] and len(set(seq[-p:])) == p: reps += 1
            if reps >= 2:
                sig.append(Signal("cycle_pattern", WEIGHTS["cycle_pattern"][0] * min(1, reps / 3), "infinite_loop", f"the last {p} calls ({' → '.join(t for t, _ in seq[-p:])}) have repeated {reps} times")); break
    tail = [r for r in results[-3:] if r.status == Status.OK and r.tool_output not in (None, {}, [], "")]
    if len(tail) == 3 and len({_canon(r.tool_output) for r in tail}) == 1 and len({_canon(c.tool_input) for c in calls[-3:]}) > 1:
        sig.append(Signal("no_progress", WEIGHTS["no_progress"][0], "infinite_loop", "the last 3 different requests all returned the same answer"))

    budget = (start.metadata.get("budget") if start else None) or {}
    if budget:
        used = {"max_tool_calls": len(calls) + (1 if intended else 0), "max_steps": len(ev), "max_tokens": sum((e.tokens_in or 0) + (e.tokens_out or 0) for e in ev),
                "max_cost_usd": sum(e.cost_usd or 0 for e in ev), "max_duration_ms": (ev[-1].timestamp - start.timestamp).total_seconds() * 1000 if ev else 0}
        for k, lim in budget.items():
            if k in used and isinstance(lim, (int, float)) and lim > 0 and used[k] / lim >= 0.7:
                sig.append(Signal("budget_burn", WEIGHTS["budget_burn"][0] * min(1, (used[k] / lim - 0.7) / 0.3), "resource_exhaustion", f"{used[k]:.4g} of {lim} {k.replace('max_', '').replace('_', ' ')} used ({used[k] / lim:.0%})"))
                break

    seen: dict[str, Event] = {}
    for r in results:
        ent = r.metadata.get("entity")
        if ent and r.status == Status.OK and isinstance(r.tool_output, dict):
            prev = seen.get(ent)
            if prev and any(k in r.tool_output and prev.tool_output[k] != r.tool_output[k] for k in prev.tool_output):
                sig.append(Signal("unresolved_contradiction", WEIGHTS["unresolved_contradiction"][0], "unsupported_success_claim", f"two results about '{ent}' disagree and nothing resolved it")); break
            seen[ent] = r
    latest: dict[str, Event] = {}
    for r in results: latest[r.tool_name] = r
    bad = [t for t, r in latest.items() if r.status == Status.ERROR]
    if bad: sig.append(Signal("unresolved_error", WEIGHTS["unresolved_error"][0], "unsupported_success_claim", f"'{bad[0]}' is still failing; claiming success now would be unsupported"))

    inj = [r for r in results if r.metadata.get("injection_indicators")]
    if inj:
        text = _canon(inj[-1].tool_output).lower()
        if intended and (intended.get("consequential") or intended["tool"].lower() in text):
            sig.append(Signal("injection_in_context", WEIGHTS["injection_in_context"][0], "prompt_injection_indicator", "untrusted content with instruction-like text is in context and the next action is consequential or named in it"))

    if intended:
        t = intended["tool"]; args = intended.get("args") or {}
        for a, b in (start.metadata.get("must_precede", []) if start else []):
            if t == b and not any(r.tool_name == a and r.status == Status.OK for r in results):
                sig.append(Signal("intended_violation", 60, "workflow_invariant_violation", f"'{b}' is about to run before '{a}' has succeeded"))
        if intended.get("consequential") and not intended.get("approved") and not any(e.event_type == EventType.HUMAN_APPROVAL and e.metadata.get("approved") is True and e.metadata.get("approves_tool") == t for e in ev):
            sig.append(Signal("intended_violation", 60, "unauthorized_action", f"'{t}' is consequential and has no prior human approval"))
        for c in (start.metadata.get("constraints", []) if start else []):
            v = args.get(c["field"])
            if c["tool"] == t and isinstance(v, (int, float)) and v > c["max"]:
                sig.append(Signal("intended_violation", 60, "goal_constraint_violation", f"{c['field']}={v} is over the task limit {c['max']}"))
        schema = intended.get("arg_schema") or {}
        miss = [k for k in schema.get("required", []) if k not in args]
        if miss: sig.append(Signal("intended_violation", 50, "invalid_tool_arguments", f"required argument(s) missing: {', '.join(miss)}"))

    cyc = next((s for s in sig if s.name == "cycle_pattern"), None); dup = next((s for s in sig if s.name == "duplicate_pressure"), None)
    if cyc and dup and cyc.points >= dup.points:       # once the cycle is the stronger explanation it also accounts for the repeated calls: report the cause once
        sig = [s for s in sig if s.name != "duplicate_pressure"]
    score = min(100, round(sum(s.points for s in sig)))
    if not sig: return Risk(0, "low", None, "low", [], "none", [])
    top = max(sig, key=lambda s: s.points); n = len(sig)
    return Risk(score, level_of(score), top.predicts, "high" if n >= 3 else "medium" if n == 2 else "low", [f"{s.detail} (+{s.points:.0f})" for s in sorted(sig, key=lambda s: -s.points)],
                ACTION_FOR.get(top.predicts, "escalate"), [s.dump() for s in sig])

def predict_run(events: list[Event], cfg: Config) -> tuple[int, list[dict]]:
    """Replay a finished/ongoing run step by step: what would the engine have said *before* each call? Returns (max score, alerts).
    One alert per predicted failure, at the first step where the score reached the alert threshold."""
    ev = sorted(events, key=lambda e: e.step_index); alerts: dict[str, dict] = {}; peak = 0
    for i, e in enumerate(ev):
        if e.event_type != EventType.TOOL_CALL: continue
        r = assess(ev[:i], cfg, {"tool": e.tool_name, "args": e.tool_input, "consequential": bool(e.metadata.get("consequential")), "arg_schema": e.metadata.get("arg_schema")})
        peak = max(peak, r.score)
        if r.score >= cfg.risk_alert_threshold and r.predicted_failure and r.predicted_failure not in alerts:
            alerts[r.predicted_failure] = {"step_index": e.step_index, **r.dump()}
    return peak, list(alerts.values())

def resolve_outcomes(alerts: list[dict], findings, step_of: dict, finished: bool) -> list[dict]:
    """Did the predicted failure actually appear? A prediction is right if a finding of that category becomes detectable at or after the prediction step."""
    for a in alerts:
        hit = [step_of.get(f.detectable_event_id or (f.evidence_event_ids[0] if f.evidence_event_ids else None)) for f in findings if f.category.value == a["predicted_failure"]]
        hit = [h for h in hit if h is not None and h >= a["step_index"]]
        if hit: a["outcome"], a["outcome_step"], a["lead_steps"] = "occurred", min(hit), min(hit) - a["step_index"]
        else: a["outcome"], a["outcome_step"], a["lead_steps"] = ("not_occurred" if finished else "pending"), None, None
    return alerts
