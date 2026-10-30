# AgentGuard — AI agent reliability layer

Observe agent traces, detect failures with deterministic rules, find the earliest detectable event, apply **safe, simulated** recovery, and benchmark protected vs unprotected runs. The core works with no paid LLM key. This is a portfolio project, not a production-certified product.

## Run it (step by step)

Prerequisites: Python 3.12+, Node 20+ and npm, git.

1. **Backend setup**
   ```bash
   cd backend
   python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
   pip install -e ".[dev]"
   ```
2. **Load synthetic demo traces** (optional but recommended)
   ```bash
   python -m app.seed
   ```
3. **Start the API** (keep this terminal open)
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   Check http://localhost:8000/health and interactive docs at http://localhost:8000/docs.
4. **Start the frontend** in a second terminal
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open http://localhost:5173 (Vite proxies `/api` to port 8000).
5. **Create your admin account.** The first time you open the app it shows *Welcome to AgentGuard*. Enter your name, email and a password of at least 10 characters. That account is the administrator. (To skip this screen on a server, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first start. To turn sign-in off on your own laptop, set `AUTH_REQUIRED=0`.)
6. **Explore** (no terminal needed): Overview → **Load demo data** → click a red incident → follow the run step by step → *What is safe to do next* → **Benchmark Lab** → *Run all scenarios* → **History** to see everything that happened and how results changed.
7. **Invite people and connect an agent:** Settings → *Team* (add people with a role) and Settings → *Connect an agent* (create an API key, copy the ready-made code).

> Upgrading from an earlier version? Your existing `agentguard.db` is upgraded automatically on startup. After upgrading, the first visit asks you to create the admin account.

### Roles
| Role | Can do |
|---|---|
| Viewer | Look at everything, change nothing |
| Member | Also run benchmarks and simulations, load demo data, add scenarios, send traces |
| Admin | Also manage people, API keys and settings; sees the security log |
| API key (for agents) | Only send traces; cannot read anything |

### Run the benchmark from the command line
```bash
cd backend
python -m app.evaluation.cli generate            # regenerate template scenarios (seeded)
python -m app.evaluation.adversarial             # regenerate hand-authored adversarial scenarios
python -m app.evaluation.cli run --json ../benchmarks/results/latest.json --csv ../benchmarks/results/latest.csv
python -m app.evaluation.cli run --ids adv-02,adv-07      # selected scenarios only
python ../scripts/render_results.py              # refresh docs/evaluation.md and the table below
```

### Run all tests
```bash
cd backend && python -m pytest        # API, detectors, localization, recovery, diagnosis, Alembic, metrics
cd sdk && python -m pytest            # SDK (also posts to the real API)
cd frontend && npm test               # React component/integration tests (mocked API)
```

### Docker (written but NOT verified — no Docker in the dev sandbox)
```bash
docker compose up --build      # UI http://localhost:8080, API http://localhost:8000
```
If it fails, run the non-Docker steps above and open an issue with the log.

### Optional: AI-assisted diagnosis
Copy `.env.example` to `.env` and set `LLM_PROVIDER=anthropic`, `LLM_API_KEY`, `LLM_MODEL`. Without them the button reports "disabled" and everything else works. This path is tested with fake providers only; it has not been run against a live model.

### Production database
Set `DATABASE_URL` to PostgreSQL, `AUTO_CREATE_TABLES=0`, then `cd backend && alembic upgrade head`.

## Instrument your own agent
```python
from agentguard_sdk import Tracer, http_transport
tracer = Tracer("my-agent", http_transport("http://localhost:8000"))
with tracer.run(required_tools=["lookup_order"]) as run:
    run.call("lookup_order", {"order_id": 1}, fn=lookup_order, read_only=True,
             arg_schema={"required": ["order_id"], "types": {"order_id": "integer"}})
    run.approval("issue_refund", approved=True)
    run.call("issue_refund", {"amount": 20}, fn=issue_refund, consequential=True)
    run.finish(claimed_success=True)
```
Detection quality depends on what you declare (`arg_schema`, `required_tools`, `consequential`, `must_precede`, `constraints`). Undeclared problems are not detected.

## Results (synthetic, simulated — read [docs/evaluation.md](docs/evaluation.md) first)
<!-- RESULTS -->
| Metric (denominator) | Baseline | Protected |
|---|---|---|
| Task success (all 135 scenarios) | 28.9% | 42.2% (Δ 95% CI 7.4 to 20.0 pts) |
| Safe outcome (all scenarios) | 28.9% | 93.3% (Δ 95% CI 56.3 to 72.6 pts) |
| Detection micro P / R / F1 | n/a | 99.3% / 98.5% / 98.9% |
| Macro-F1 (categories with support) | n/a | 98.8% |
| False-positive rate (clean scenarios, n=39) | n/a | 2.6% |
| Localization accuracy (n=96 labelled) | n/a | 97.9%, mean abs step error 0.01 |
| Recovery success (attempted recoveries, n=30) | n/a | 66.7% |
| Unnecessary intervention rate (clean scenarios) | n/a | 2.6% |
| Added latency, mean ± std per scenario | n/a | 0.052 ± 0.019 ms |
| Cost per run | n/a | $0 (no paid model calls) |
<!-- /RESULTS -->

## The interface
Sidebar pages: **Overview** (health donut, what is going wrong, severity, trend, urgent incidents, benchmark summary) · **Traces** (search, status/severity/problem-type/agent filters, sorting, pagination) · **Investigation** (clickable run timeline marking origin / first detectable / observed, findings with plain-English why and fix, safe-action preview + simulator, optional AI second opinion) · **Benchmark Lab** (pick scenarios, with-vs-without charts, per-type quality heat table, plain-language mistakes, compare runs, export) · **Scenarios** · **Settings** (status, limits, connect-your-agent, glossary). Hover the ⓘ icons for definitions.

## What exists
10 deterministic detectors · localization (origin / first detectable / observed) · recovery policy + simulator · 135 scenarios (JSON or YAML) · benchmark API with background execution · SDK · React dashboard (Overview with trend chart, Traces, Benchmark Lab, Scenarios, Settings) · rate limiting · redaction · retention (at startup) · Alembic migration.

## Known limitations
Authentication is built in (see Roles) but has no single sign-on, two-factor or email-based password reset (admins reset passwords); session tokens live in the browser’s local storage; rate limiting is in-memory per process (and per proxy IP behind a proxy); retention runs at startup only; no live recovery adapters; no browser (Playwright) E2E tests — the frontend is tested with mocked API calls and the full journey is tested at API level; Docker/Compose and deployment unverified; screenshots not included (see docs/portfolio.md); date-range filtering exists in the API but not in the UI; trace list filtering by category runs in memory (fine for thousands of traces, not millions).
