# AgentGuard — AI agent reliability layer

Observe agent traces, detect failures with deterministic rules, find the earliest detectable event, apply **safe, simulated** recovery, and benchmark protected vs unprotected runs. The core works with no paid LLM key. This is a portfolio project, not a production-certified product.

## Run it (step by step)

Prerequisites: Python 3.12+, Node 20+ and npm, git.

1. **Backend setup**
   ```bash
   cd backend
   python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
   python -m pip install -e ".[dev]" -e ../sdk
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
| API key (for agents) | Send traces, ask for a runtime decision before a tool runs, poll an approval; cannot read or change anything else |

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

## Protect your own agent (SDK)
```python
from agentguard import AgentGuard, ToolCallBlocked
guard = AgentGuard(api_url="http://localhost:8000", api_key="ag_...", mode="enforce")   # key from Settings → Connect an agent

@guard.tool("issue_refund", consequential=True)
def issue_refund(order_id, amount): ...

with guard.trace(agent_name="support-agent", task="Refund ORD-1") as run:
    run.tools.issue_refund(order_id="ORD-1", amount=20)   # checked BEFORE it runs; may raise ToolCallBlocked or wait for a human
    run.finish(claimed_success=True)
```
Create rules in **Policy Center** (start from a template), watch warnings in **Risk Monitor**, decide on held actions in **Approvals**. Details: [docs/SDK_GUIDE.md](docs/SDK_GUIDE.md).

## Results (synthetic, simulated — read [docs/evaluation.md](docs/evaluation.md) first)
<!-- RESULTS -->
| Metric (denominator) | Baseline | Protected |
|---|---|---|
| Task success (all 189 scenarios) | 26.5% | 35.4% (Δ 95% CI 4.8 to 13.2 pts) |
| Safe outcome (all scenarios) | 26.5% | 95.2% (Δ 95% CI 61.9 to 75.7 pts) |
| Detection micro P / R / F1 | n/a | 99.5% / 98.9% / 99.2% |
| Macro-F1 (categories with support) | n/a | 99.2% |
| False-positive rate (clean scenarios, n=50) | n/a | 2.0% |
| Localization accuracy (n=139 labelled) | n/a | 98.6%, mean abs step error 0.01 |
| Recovery success (attempted recoveries, n=29) | n/a | 65.5% |
| Unnecessary intervention rate (clean scenarios) | n/a | 2.0% |
| Early-warning precision (n=76 warnings) | n/a | 88.2% |
| Early-warning recall (n=152 predictable failures) | n/a | 44.1% |
| Added latency, mean ± std per scenario | n/a | 0.058 ± 0.038 ms |
| Cost per run | n/a | $0 (no paid model calls) |
<!-- /RESULTS -->

## The interface
Sidebar pages: **Overview** (health donut, what is going wrong, severity, trend, urgent incidents, benchmark summary) · **Traces** (search, status/severity/problem-type/agent filters, sorting, pagination) · **Investigation** (clickable run timeline marking origin / first detectable / observed, findings with plain-English why and fix, safe-action preview + simulator, optional AI second opinion) · **Benchmark Lab** (pick scenarios, with-vs-without charts, per-type quality heat table, plain-language mistakes, compare runs, export) · **Scenarios** · **Settings** (status, limits, connect-your-agent, glossary). Hover the ⓘ icons for definitions.

## What exists vs what is planned
Built and tested: workspaces with isolation, auth/roles/API keys, ingestion with redaction, 15 detectors, risk prediction with tracked outcomes, policy engine (versioned, testable, simulatable), approvals, SDK with pre-execution enforcement, 189-scenario synthetic benchmark with splits, React dashboard. **Not built yet:** verified recovery engine, sample agents + demo launcher, trace → regression scenario + replay, three-mode benchmark on real runs, competitive analysis. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the full, honest matrix and [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
