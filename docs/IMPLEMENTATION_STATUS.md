# Implementation status

Legend: ✅ built and tested · 🟡 partly built (what is missing is stated) · ❌ not started.
Test counts at the time of writing: backend 105 · SDK 12 · frontend 37 (all passing). Docker, Postgres and a live deployment were **not** exercised in the build sandbox.

## Module-by-module against the master prompt

| Module / requirement | Status | Notes |
|---|---|---|
| **1. SDK** — framework-independent, `AgentGuard`, `with guard.trace()`, low-level `start_trace` | ✅ | `sdk/agentguard`. Tool registry, `run.tools.x()`, `run_agent`, context propagation (contextvar). |
| SDK pre-execution interception; observe / warn / enforce | ✅ | A blocked tool function is provably never called (tested). Fail-closed in enforce, fail-open otherwise. |
| SDK approval waiting, policy checking, risk | ✅ | Polls the approval; server verifies the approval is for exactly these arguments and single-use. |
| SDK recovery hooks | ❌ | Phase 5. |
| LangChain / LangGraph integrations | ❌ | Optional in the prompt; not started. |
| **2. Trace collector** — runs, events, redaction, retention, pagination, search | ✅ | Run facts (task, mode, outcome, duration, tokens, cost, risk, blocked, recoveries) derived from events. |
| Trace comparison, export | 🟡 | API only (`/traces/compare`, `/traces/{id}/export`); no UI. |
| Parent–child event display, event-type names | 🟡 | `parent_event_id` is stored but not drawn. Event types use lower-case names (`run_start` = AGENT_START etc.). |
| **3. Detection** — 14 failure categories | ✅ | 15 rules. Goal deviation covers explicit constraints only. Prompt injection is a labelled heuristic. |
| Finding fields (id, rule, confidence, evidence, severity incl. INFO, source) | ✅ | Persisted in `findings`. Confidence 1.0 = rule verified; <1.0 = documented heuristic strength, not a probability. |
| Model-assisted findings stored separately | 🟡 | Optional AI diagnosis exists; it does not create stored findings. |
| **4. Risk prediction** — score, level, evidence, confidence, stored, outcomes, metrics | ✅ | Transparent weighted rules (see RISK_PREDICTION.md). No pre-finish check; no historical-pattern signal; no supervised model (optional in the prompt). |
| **5. Policy engine** — schema, CRUD, versions, rollback, enable, test, simulate, logs, enforcement | ✅ | 10 condition types, 5 decisions, scopes by agent/tool, argument and role rules. `DEFER` is decided and logged but the SDK treats it as "not allowed". |
| **6. Localization** | 🟡 | Origin / first-detectable / observed ✅. Missing: affected downstream events, cause classification (agent/tool/environment/policy/external), alternative hypotheses and confirmed-vs-hypothesis tiers. |
| LLM diagnosis provider | 🟡 | One optional provider (Anthropic) behind an abstraction; the prompt asks for an OpenAI-compatible one too. Never run against a live model. |
| **7. Recovery engine** | 🟡 | A simulated policy (`retry`, `correct_args`, `request_evidence`, `escalate`, `stop`) exists and the table for persisted attempts exists but is unused. Missing: proposals with permission/approval checks, SWITCH_TOOL, REPLAN, ROLLBACK, idempotency, execution records, **verification of the original objective**. |
| **8. Approvals** — queue, approve/reject/request changes, history, timeout | ✅ | Expiry is treated as rejection; there is no escalation-on-timeout. |
| **9. Regression & replay** | 🟡 | 189 built-in scenarios + custom JSON scenarios, dev/validation/test split ✅. Missing: **trace → scenario conversion, replay, execution comparison, saved regression suites, scenario editing, executable mock-tool scenarios**. |
| **10. Benchmark lab** | 🟡 | Detection, localization, outcome, recovery, latency, early-warning metrics with CIs and splits ✅. Missing: real baseline vs observe vs enforce runs of an agent, unsafe-recovery rate, policy-violation-prevention rate, report export. |
| **11. Dashboard** | 🟡 | Real data, empty states ✅. API supports date/agent/environment/severity filters, but the UI exposes only some; no reliability/recovery/policy-violation trend charts beyond runs and flagged runs. |
| **Pages** (11 required) | 🟡 | Overview ✅ · Agent Runs ✅ · Trace Explorer 🟡 · Failure Investigation 🟡 · Risk Monitor ✅ · Safety Rules / Policy Center ✅ · **Recovery Center ❌** (Approvals page covers only approvals) · Scenario Library 🟡 (no edit) · Benchmark Lab ✅ · **Integrations ✅** (4-step wizard that registers the agent, creates a key, fills in the code and confirms the first run; API keys with rotation in Settings) · Settings 🟡 (no workspace rename or model-provider form). Added beyond the list: **Agents** and **Problems** pages. |
| **Demo environment** — 3 sample agents with mock tools and launch buttons | ❌ | Next. |
| **Security** — auth, workspace isolation, API-key hashing + rotation, RBAC, redaction, audit, CORS, rate limits, safe errors | ✅ | Workspace isolation is tested with two real tenants. See SECURITY_MODEL.md. |
| Stack differences from the prompt | — | Frontend is plain JavaScript + React + Vite + Recharts (you asked for JS; a test forbids TypeScript files); no Tailwind, TanStack Query or React Router (a small hash router is used). The API layer is separated from the UI (see FRONTEND_ARCHITECTURE.md). PostgreSQL is supported but was only run on SQLite here. No Redis (not needed). |
| **Docs** | 🟡 | Written: this file, SYSTEM_ARCHITECTURE, API_DOCUMENTATION, SDK_GUIDE, FAILURE_DETECTION, RISK_PREDICTION, POLICY_ENGINE, DATABASE_SCHEMA, SECURITY_MODEL, DEPLOYMENT_GUIDE, LIMITATIONS, ROADMAP, evaluation.md. FRONTEND_ARCHITECTURE. **Not written:** COMPETITIVE_ANALYSIS, PRODUCT_DIFFERENTIATION (both need web research), PRODUCT_OVERVIEW, RECOVERY_ENGINE. |
| **Examples folder** (3 agents) | ❌ | With the demo environment. |

## The 12 end-to-end workflows in the prompt
1 success ✅ · 2 invalid arguments ✅ · 3 repeated-tool loop ✅ · 4 tool timeout 🟡 (detected; recovery is simulated) · 5 unauthorized action ✅ (blocked in enforce) · 6 unsupported success ✅ · 7 predictive warning ✅ · 8 recovery that is **verified** ❌ · 9 stopped after unsafe action ✅ · 10 trace → regression scenario ❌ · 11 replay ❌ · 12 baseline vs protected 🟡 (simulated, not three real modes).
Most are tested at the API level with real HTTP-equivalent calls; there are no browser (Playwright) tests.

## Known bugs / things to know
- `adv-02`, `adv-09`, `adv-10` are real detector misses (volatile timestamps, undeclared schemas, unmarked consequential actions) — documented in evaluation.md.
- The risk engine only reasons at tool calls, so budget breaches inside a model call and false success claims are not warned about in advance.
- Migration 0004 builds tables from the models; later migrations on those tables must check for existing columns.
- API keys carry the `agent` role: they can ingest, ask for a runtime decision, poll an approval and nothing else.

## Next steps, in order
1. **Phase 5 — Recovery engine:** proposals with permission + approval checks, persisted attempts, SWITCH_TOOL / REPLAN / ROLLBACK, idempotency rules, objective verification, SDK hooks, Recovery Center page.
2. **Demo environment:** three deterministic sample agents with mock tools, fault injection, launch buttons, `examples/`.
3. **Phase 6 — Regression:** trace → scenario (with redaction), replay against a sample agent, execution diff, saved suites, scenario editing.
4. **Phase 7 — Benchmark:** run the sample agents unprotected / observe / enforce and report reliability, prevention and overhead.
5. **Research docs:** competitive analysis and differentiation from current sources.
6. Remaining UI gaps (Integrations page, trend charts, filters), Docker/Postgres/CI verification, screenshots.
