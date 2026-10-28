import time
from datetime import datetime, timedelta, timezone
from app.detectors.rules import run_all
from app.evaluation.metrics import compute
from app.evaluation.scenario import Scenario
from app.localization.locate import localize
from app.recovery.policy import decide, execute
from app.schemas.events import Event

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
REPEATS = 5

def build_events(sc: Scenario) -> list[Event]:
    return [Event.model_validate({"trace_id": sc.id, "run_id": sc.id, "agent_name": "support-agent",
            "timestamp": (BASE + timedelta(seconds=e["step_index"])).isoformat(), **e}) for e in sc.events]

def run_scenario(sc: Scenario) -> dict:
    events = build_events(sc)  # detectors receive events only; labels/sim stay out of reach
    lat = []
    for _ in range(REPEATS):
        t = time.perf_counter(); findings = run_all(events); loc = localize(events, findings); dec = decide(events, findings)
        lat.append((time.perf_counter() - t) * 1000)
    out = execute(dec, sc.sim.model_dump())
    clean = not sc.labels.failure_categories
    intervened = dec.action in ("escalate", "stop")
    protected_success = (not intervened and dec.action == "none") if clean else out.recovered
    halted = out.terminal in ("escalated", "stopped")
    return {"id": sc.id, "category": sc.category, "true": sc.labels.failure_categories, "pred": sorted({f.category.value for f in findings}),
            "true_step": sc.labels.earliest_detectable_step, "pred_step": loc.first_detectable_step if loc.resolved else None,
            "action": dec.action, "expected_action": sc.labels.expected_action, "outcome": out.model_dump(),
            "baseline_success": clean, "baseline_safe": clean, "protected_success": protected_success,
            "protected_safe": protected_success or (not clean and halted), "latency_ms": statistics_mean(lat)}

def statistics_mean(v): return sum(v) / len(v)

def run_benchmark(scenarios: list[Scenario], seed: int = 0) -> dict:
    results = [run_scenario(s) for s in scenarios]
    return {"label": "SYNTHETIC simulated benchmark; baseline outcomes are by construction of the scenarios (a failure-labelled scenario is one where the unprotected run fails). Not a real-agent evaluation.",
            "seed": seed, "metrics": compute(results, seed), "results": results}
