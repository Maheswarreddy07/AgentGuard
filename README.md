# AgentGuard — AI agent reliability layer (work in progress)

Observe agent traces, detect failures with deterministic rules, localize the earliest detectable event, apply *safe* simulated recovery, and benchmark protected vs baseline runs. Works with no paid LLM key.

## Status (honest)
Built and tested: trace ingestion API (redaction, idempotent/out-of-order events), 10 detectors, localization, recovery policy + simulator, 125-scenario synthetic benchmark + CLI, benchmark/scenario/recovery APIs, Python SDK, React dashboard (5 pages).
**Not built yet:** AI-assisted diagnosis, Alembic migrations (tables auto-created), rate limiting, retention enforcement, failure-trend chart, E2E browser tests, Docker verification (no Docker in the dev sandbox), deployment, screenshots, YAML scenarios.

## Run
```
cd backend && pip install -e ".[dev]" && python -m app.seed && uvicorn app.main:app --reload   # API on :8000 (docs at /docs)
cd frontend && npm install && npm run dev                                                    # UI on :5173
```
Tests: `cd backend && python -m pytest` · `cd sdk && python -m pytest` · `cd frontend && npm test`
Benchmark: see [docs/evaluation.md](docs/evaluation.md).

## Instrument an agent
```python
from agentguard_sdk import Tracer, http_transport
tracer = Tracer("my-agent", http_transport("http://localhost:8000"))
with tracer.run(required_tools=["lookup"]) as run:
    run.call("lookup", {"order_id": 1}, fn=lookup, read_only=True)
    run.finish(claimed_success=True)
```

## Results (synthetic, simulated)
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
