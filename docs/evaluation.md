# Evaluation

**All numbers are from a SYNTHETIC, SIMULATED benchmark** (125 scenarios, seed 0), reproduced with:
`cd backend && python -m app.evaluation.cli generate && python -m app.evaluation.cli run --json ../benchmarks/results/latest.json`

| Metric (denominator) | Baseline | Protected |
|---|---|---|
| Task success (all 125 scenarios) | 28.8% | 41.6% (Δ 95% CI 7.2 to 19.2 pts) |
| Safe outcome (all scenarios) | 28.8% | 94.4% (Δ 95% CI 56.8 to 73.6 pts) |
| Detection micro P / R / F1 | n/a | 100.0% / 100.0% / 100.0% |
| Macro-F1 (categories with support) | n/a | 100.0% |
| False-positive rate (clean scenarios, n=36) | n/a | 0.0% |
| Localization accuracy (n=89 labelled) | n/a | 100.0%, mean abs step error 0.00 |
| Recovery success (attempted recoveries, n=26) | n/a | 61.5% |
| Unnecessary intervention rate (clean scenarios) | n/a | 0.0% |
| Added latency, mean ± std per scenario | n/a | 0.013 ± 0.005 ms |
| Cost per run | n/a | $0 (no paid model calls) |

## How it is built
- Scenarios live in `benchmarks/scenarios/v1/*.json`. Detectors receive `events` only; `labels` (ground truth) and `sim` (recovery simulation) are never passed to them.
- Baseline outcomes are **by construction**: a failure-labelled scenario is one where the unprotected run fails. Protected outcomes come from the recovery policy plus a deterministic simulated environment.
- Safe outcome = succeeded, or recovered, or stopped/escalated before completing a violating action.
- Task success CIs: 1000-resample bootstrap over scenarios (paired for the difference). Latency: mean of 5 repeats per scenario.

## Limitations (read before quoting any number)
- Scenarios and detectors are written by the same author and detectors read the metadata the templates emit (`arg_schema`, `required_tools`, ...). Near-perfect detection is therefore expected and says nothing about real agents.
- A first run showed 88.8% localization; investigation found a real localizer bug (contradictions reported the origin as the detectable event), fixed with explicit origin/detectable fields. Perfect scores now mean the labels and code agree, not that the problem is solved.
- No LLM diagnosis, no real agents, no live recovery. Cost is $0 only because no model was called.
- Next credible step: noisy/adversarial scenarios authored independently, and traces from real agents.
