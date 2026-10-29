"""Render docs/evaluation.md and the README results table from benchmarks/results/latest.json (never hand-typed)."""
import json, re
from pathlib import Path
R = Path(__file__).resolve().parents[1]
res = json.load(open(R / "benchmarks/results/latest.json")); m = res["metrics"]
P = lambda v: "n/a" if v is None else f"{v*100:.1f}%"
ci = lambda c: f"{c[0]*100:.1f} to {c[1]*100:.1f} pts"
d, o, l, r = m["detection"], m["outcomes"], m["localization"], m["recovery"]
table = f"""| Metric (denominator) | Baseline | Protected |
|---|---|---|
| Task success (all {m['n_scenarios']} scenarios) | {P(o['baseline_task_success'])} | {P(o['protected_task_success'])} (Δ 95% CI {ci(o['success_improvement_ci95'])}) |
| Safe outcome (all scenarios) | {P(o['baseline_safe_outcome'])} | {P(o['protected_safe_outcome'])} (Δ 95% CI {ci(o['safe_outcome_improvement_ci95'])}) |
| Detection micro P / R / F1 | n/a | {P(d['micro_precision'])} / {P(d['micro_recall'])} / {P(d['micro_f1'])} |
| Macro-F1 (categories with support) | n/a | {P(d['macro_f1'])} |
| False-positive rate (clean scenarios, n={m['n_clean']}) | n/a | {P(d['false_positive_rate'])} |
| Localization accuracy (n={l['n_labelled']} labelled) | n/a | {P(l['accuracy'])}, mean abs step error {l['mean_abs_step_error']:.2f} |
| Recovery success (attempted recoveries, n={r['n_attempted']}) | n/a | {P(r['recovery_success_rate'])} |
| Unnecessary intervention rate (clean scenarios) | n/a | {P(m['unnecessary_intervention_rate'])} |
| Added latency, mean ± std per scenario | n/a | {m['latency_ms']['mean_added']:.3f} ± {m['latency_ms']['std']:.3f} ms |
| Cost per run | n/a | $0 (no paid model calls) |"""
miss = [f"- `{x['id']}`: expected {x['true'] or 'no failure'}, detected {x['pred'] or 'nothing'}" for x in res["results"] if sorted(x["true"]) != sorted(x["pred"])]
(R / "docs/evaluation.md").write_text(f"""# Evaluation

**All numbers come from a SYNTHETIC, SIMULATED benchmark** ({m['n_scenarios']} scenarios: 125 generated from templates + 10 hand-authored adversarial), seed 0.
Reproduce: `cd backend && python -m app.evaluation.cli generate && python -m app.evaluation.adversarial && python -m app.evaluation.cli run --json ../benchmarks/results/latest.json && python ../scripts/render_results.py`

{table}

## Where AgentGuard is wrong (from the data)
{chr(10).join(miss)}

Known causes: (1) a volatile field such as a timestamp makes two reads of one entity look contradictory; (2) invalid arguments are only detectable if the instrumentation declares an `arg_schema`; (3) an action is only treated as consequential if the instrumentation marks it so; (4) `repeated_failures` only matches *consecutive* identical failures.

## Method
- Detectors receive `events` only; `labels` (ground truth) and `sim` (simulated recovery environment) are never passed to them.
- Baseline outcomes are by construction: a failure-labelled scenario is one where the unprotected run fails. Protected outcomes come from the recovery policy plus a deterministic simulator.
- Safe outcome = succeeded, or recovered, or stopped/escalated before completing a violating action.
- Task-success CIs: 1000-resample bootstrap over scenarios (paired for the difference). Latency: mean of 5 repeats per scenario.

## Limitations (read before quoting any number)
- The 125 template scenarios and the detectors share an author, so detection on them is near-perfect by design. The 10 adversarial scenarios are a small, still self-authored stress test: they were written first, they exposed a real `retry_loop` bug that was then fixed (so that scenario is no longer a held-out test).
- No real agents, no live recovery, no LLM diagnosis in the benchmark. Cost is $0 only because no model was called.
- Next credible step: scenarios authored by someone else and traces from real agents.
""")
rd = (R / "README.md").read_text()
rd = re.sub(r"<!-- RESULTS -->.*?<!-- /RESULTS -->", f"<!-- RESULTS -->\n{table}\n<!-- /RESULTS -->", rd, flags=re.S)
(R / "README.md").write_text(rd)
print("rendered")
