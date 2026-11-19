# Limitations

- **Evidence base is synthetic.** All benchmark numbers come from scenarios written by the same author as the detectors. No real agent has been evaluated.
- **Baseline vs protected is simulated**, not three real runs of an agent.
- **Recovery is simulated** and its success is not verified against the task objective yet.
- **Detection depends on declarations** (schemas, required tools, constraints, budgets, `consequential`/`external`). Unmarked risky actions are missed.
- **Risk engine** is rules, only reasons at tool calls, and cannot predict a first failure.
- **Prompt-injection and near-duplicate detection are heuristics.**
- **AI diagnosis** was only tested with fake providers.
- **SDK**: Python only; no LangChain/LangGraph adapters; `DEFER` is treated as "not allowed".
- **Security**: no SSO/2FA/email reset; session token in browser local storage; in-memory rate limiter (per process, per IP).
- **Verified:** all backend tests on SQLite and PostgreSQL 16; backup/restore with pg_dump; the UI in real Chromium (3 screen sizes, main user flows).
- **Not verified:** building the Docker images, Docker Compose, HTTPS/proxy set-up, a live deployment, Firefox/Safari, automated browser tests in CI.
- **Recovery:** the SDK executes real, bounded recovery for read-only tools only; the server-side benchmark recovery is still simulated. Nothing automatic ever retries a consequential action.
- **Test runs** execute inside the API process (capped, interrupted runs marked failed); there is no separate worker queue.
- **Regression tests** from real failures keep structure only; problems that depended on removed text (for example hidden instructions) cannot be tested that way.
- **Benchmark scores** are consistency checks: the detection rules were written while looking at these scenarios.
