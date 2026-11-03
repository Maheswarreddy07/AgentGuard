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
- **Not verified here:** Docker/Compose, PostgreSQL, deployment, browser end-to-end tests, screenshots.
