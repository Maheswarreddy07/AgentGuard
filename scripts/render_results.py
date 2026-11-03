"""Render docs/evaluation.md and the README results table from benchmarks/results/latest.json (never hand-typed)."""
import json, re
from pathlib import Path
R = Path(__file__).resolve().parents[1]
res = json.load(open(R / "benchmarks/results/latest.json")); m = res["metrics"]
P = lambda v, d=1: "n/a" if v is None else f"{v*100:.{d}f}%"
ci = lambda c: f"{c[0]*100:.1f} to {c[1]*100:.1f} pts"
d, o, l, r, k = m["detection"], m["outcomes"], m["localization"], m["recovery"], m["risk"]
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
| Early-warning precision (n={k['n_alerts']} warnings) | n/a | {P(k['early_precision'])} |
| Early-warning recall (n={k['n_failures']} predictable failures) | n/a | {P(k['early_recall'])} |
| Added latency, mean ± std per scenario | n/a | {m['latency_ms']['mean_added']:.3f} ± {m['latency_ms']['std']:.3f} ms |
| Cost per run | n/a | $0 (no paid model calls) |"""
splits = "\n".join(f"| {s} | {v['n']} | {P(v['precision'])} | {P(v['recall'])} | {P(v['false_positive_rate'])} (n={v['n_clean']}) | {P(v['risk_early_precision'], 0)} | {P(v['risk_early_recall'], 0)} |" for s, v in m["by_split"].items())
cats = "\n".join(f"| {c.replace('_', ' ')} | {v['caught']} of {v['total']} |" for c, v in k["per_category"].items())
miss = [f"- `{x['id']}`: expected {x['true'] or 'no failure'}, detected {x['pred'] or 'nothing'}" for x in res["results"] if sorted(x["true"]) != sorted(x["pred"])]
(R / "docs/evaluation.md").write_text(f"""# Evaluation

**All numbers come from a SYNTHETIC, SIMULATED benchmark** ({m['n_scenarios']} scenarios: template-generated + 10 hand-written adversarial), seed 0. Nothing here comes from a real agent.
Reproduce: `cd backend && python -m app.evaluation.cli generate && python -m app.evaluation.adversarial && python -m app.evaluation.cli run --json ../benchmarks/results/latest.json && python ../scripts/render_results.py`

{table}

## Detection quality by data split
Scenarios are assigned to dev / validation / test by a fixed hash of their id (60/20/20), so a scenario can never move between sets.

| Set | Scenarios | Precision | Recall | False alarms on healthy runs | Early-warning precision | Early-warning recall |
|---|---|---|---|---|---|---|
{splits}

**Caveat:** the detectors and the risk weights were written and adjusted while looking at these scenarios, so even the "test" set is not independent. It is a consistency check, not proof of generalisation.

## Early warnings: which failures were warned about before they happened
Graded against the ground-truth labels (not against the detectors' own findings). Types listed under "no early signal" can only be detected after they happen.

| Failure type | Warned first |
|---|---|
{cats}

No early signal exists for: {', '.join(c.replace('_', ' ') for c in k['not_covered_failure_types'])}. A first-ever tool failure cannot be predicted. Token/cost budget breaches that happen inside a model call have no tool call to intercept, so they are not warned about. Success claims are only checked after the fact: there is no pre-finish check yet.

## Where AgentGuard is wrong (detection)
{chr(10).join(miss)}

Known causes: (1) a volatile field such as a timestamp makes two reads of one entity look contradictory; (2) invalid arguments are only detectable if the instrumentation declares an `arg_schema`; (3) an action is only treated as consequential if the instrumentation marks it so.

## Method
- Detectors receive `events` only; `labels` (ground truth) and `sim` (simulated recovery environment) are never passed to them.
- Baseline outcomes are by construction: a failure-labelled scenario is one where the unprotected run fails. Protected outcomes come from the recovery policy plus a deterministic simulator. **This is not yet a comparison of three real agent modes (baseline / observe / enforce) — that is planned.**
- Safe outcome = succeeded, or recovered, or stopped/escalated before completing a violating action.
- Task-success CIs: 1000-resample bootstrap over scenarios (paired for the difference). Latency: mean of 5 repeats per scenario.
- Risk predictions are replayed step by step over each scenario; a warning is "right" if its failure type is in the scenario's labels and becomes detectable at or after the warning step (per-category steps where they differ).

## Limitations (read before quoting any number)
- Scenarios and detectors share an author. Near-perfect detection on template scenarios is expected by design.
- The adversarial set found real bugs (retry-loop timing, near-duplicate matching treating sequential ids as duplicates, an over-narrow injection pattern) that were then fixed, so those cases are no longer held out.
- No real agents, no live recovery, no LLM diagnosis in the benchmark. Cost is $0 only because no model was called.
""")
rd = (R / "README.md").read_text()
rd = re.sub(r"<!-- RESULTS -->.*?<!-- /RESULTS -->", f"<!-- RESULTS -->\n{table}\n<!-- /RESULTS -->", rd, flags=re.S)
(R / "README.md").write_text(rd)
print("rendered")
