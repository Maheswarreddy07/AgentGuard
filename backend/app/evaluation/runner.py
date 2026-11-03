import time
from datetime import datetime, timedelta, timezone
from app.detectors.rules import run_all
from app.evaluation.metrics import compute
from app.evaluation.scenario import Scenario
from app.detectors.scanners import annotate_event
from app.localization.locate import localize
from app.recovery.policy import decide, execute
from app.risk.engine import predict_run
from app.services.settings import Config, default_config
from app.schemas.events import Event

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
REPEATS = 5

def build_events(sc: Scenario) -> list[Event]:
    return [annotate_event(Event.model_validate({"trace_id": sc.id, "run_id": sc.id, "agent_name": "support-agent",
            "timestamp": (BASE + timedelta(seconds=e["step_index"])).isoformat(), **e})) for e in sc.events]

def run_scenario(sc: Scenario, cfg: Config | None = None) -> dict:
    cfg = cfg or default_config()
    events = build_events(sc)  # detectors receive events only; labels/sim stay out of reach
    lat = []
    for _ in range(REPEATS):
        t = time.perf_counter(); findings = run_all(events, cfg.disabled_rules, cfg.retry_loop_threshold, cfg.duplicate_call_threshold); loc = localize(events, findings); dec = decide(events, findings, cfg.max_retries)
        lat.append((time.perf_counter() - t) * 1000)
    out = execute(dec, sc.sim.model_dump(), cfg.max_retries)
    peak, alerts = predict_run(events, cfg)
    truth, first = sc.labels.failure_categories, sc.labels.earliest_detectable_step
    for a in alerts:      # graded against the GROUND-TRUTH labels, not against the detectors' own findings
        if a["predicted_failure"] not in truth: a["outcome"], a["lead_steps"] = "not_occurred", None
        elif (st := sc.labels.category_steps.get(a["predicted_failure"], first)) is None or st >= a["step_index"]: a["outcome"], a["lead_steps"] = "occurred", (st - a["step_index"]) if st is not None else None
        else: a["outcome"], a["lead_steps"] = "late", None
    clean = not sc.labels.failure_categories
    intervened = dec.action in ("escalate", "stop")
    protected_success = (not intervened and dec.action == "none") if clean else out.recovered
    halted = out.terminal in ("escalated", "stopped")
    return {"id": sc.id, "category": sc.category, "true": sc.labels.failure_categories, "pred": sorted({f.category.value for f in findings}),
            "true_step": sc.labels.earliest_detectable_step, "pred_step": loc.first_detectable_step if loc.resolved else None,
            "action": dec.action, "expected_action": sc.labels.expected_action, "outcome": out.model_dump(),
            "baseline_success": clean, "baseline_safe": clean, "protected_success": protected_success,
            "protected_safe": protected_success or (not clean and halted), "latency_ms": statistics_mean(lat), "split": sc.split, "risk": {"peak": peak, "alerts": [{k: a[k] for k in ("predicted_failure", "step_index", "score", "level", "confidence", "outcome", "lead_steps")} for a in alerts]}}

def statistics_mean(v): return sum(v) / len(v)

def run_benchmark(scenarios: list[Scenario], seed: int = 0, cfg: Config | None = None) -> dict:
    cfg = cfg or default_config()
    results = [run_scenario(s, cfg) for s in scenarios]
    return {"label": "SYNTHETIC simulated benchmark; baseline outcomes are by construction of the scenarios (a failure-labelled scenario is one where the unprotected run fails). Not a real-agent evaluation.",
            "seed": seed, "config": {"max_retries": cfg.max_retries, "retry_loop_threshold": cfg.retry_loop_threshold, "disabled_rules": sorted(cfg.disabled_rules)}, "metrics": compute(results, seed), "results": results}
