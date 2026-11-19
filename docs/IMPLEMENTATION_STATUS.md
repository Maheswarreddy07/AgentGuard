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


## Role-based pages and access (added)
- Done: role homes (Overview / My work / Admin console), per-role sidebar, page guard, capability-based API guards, one catalog for UI and API, Scenarios text served from the backend. See docs/ROLES_AND_ACCESS.md.
- Partial: only Scenarios, My work, Admin console and the access messages take their text from the backend. Other pages still have fixed wording.


## Simplified UI, guided connect, top menu (added)
- Done: three-line top menu (AppMenu replaces AppSidebar), lazy-loaded pages, sections that load one after another (Staged), error boundary, four-number Overview with the old report behind a toggle, Connect-an-agent with three paths (sample run, guided download-and-run, developer message), sample-run and starter-file endpoints, login and shell text served by the backend.
- Partial: Settings, Policies, Benchmark Lab, Traces, Trace detail, Risk, Problems, Approvals, Activity and the old full report still contain fixed wording.
- Not verified: Docker, PostgreSQL, a live deployment, a real browser (checked with jsdom against a real backend instead).


## Simpler pages, themes, delete, database, no hardcoded wording (added)
- Done: light/dark/match-my-device theme (remembered), simplified Risk Monitor and Scenarios, sections that load as you scroll (Scenarios, Risk), delete buttons with confirmation for runs, agents, practice situations, safety rules, people, API keys and demo data, database status and SQLite backup in the Admin console, retention that no longer leaves orphaned findings, all screen wording served by the backend with tests that stop it creeping back.
- Partial: infinite scroll is on Scenarios and Risk; the run list still uses pages. Keys in ui_strings.json are auto-generated.
- Not verified: Docker, PostgreSQL (and restoring a backup), a live deployment, a real browser.


## Audit steps 1 to 4 (added)
See docs/AUDIT.md. Done: full audit; production vs demo/sample/starter separation (origin on runs and agents, scoped endpoints, migration 0005, labelled Demo data view); scenario library de-duplicated (189 files, 128 distinct) with split-leakage removed; benchmark results carry dataset/version metadata, denominators, Wilson intervals and sample-size warnings; incomparable runs are refused; docs regenerated. Not started: navigation redesign, Simple/Advanced mode, page redesigns, regression-from-production, a real recovery engine.


## Steps 5 to 7 (added)
Done: horizontal navigation with section tabs and an account menu; Simple/Advanced mode; new Home with next steps computed from recorded data. See docs/AUDIT.md section 6 for what remains.


## Steps 8 to 11 (added)
Done: richer Agents, Activity timeline, Problems grouped with the five answers and resolve/reopen, agent-scoped safety rules. See docs/AUDIT.md section 6.

## Redesign round (single interface, Test & Improve)
Done and tested: one interface (no Simple/Advanced, no demo switch); horizontal nav fix; Test Library / Run Tests / Results (synthetic, labelled, counts always shown with denominators);
plain-language problems (repeats of one problem in one run shown once with a count); Activity filters; profile menu (My account, Connection settings, Settings, Team management, Sign out); Settings tabs renamed.
Verified: backend 130 tests, frontend 67 (+3 skipped), production build, 20 pages x 3 roles against a live backend (jsdom, not a real browser).
Not done / not verified: real recovery engine (still simulated), production-to-regression workflow, per-key rate limiting, job queue, Docker/PostgreSQL/deployment, real-browser and mobile layout checks,
a separate "AI provider" and "Data retention" Settings tab (those controls still live inside "Safety and detection").

## Production round
Added and tested: SDK recovery that really runs (bounded retries with back-off and a time limit, schema-validated argument fixes, goal verification, consequential tools never retried); per-API-key rate limits; Idempotency-Key for writes (migration 0006);
interrupted/concurrent test-run handling; production-to-regression tests (text removed, human confirmation, audit-logged); per-rule effect statistics; Settings tabs (AI provider, Data retention); security headers and body-size limit; non-root Docker image, Compose requires a database password and publishes only the web container.
Verified: backend 142 tests on SQLite and on PostgreSQL 16, SDK 27, frontend 70 (+3 skipped), build, real-Chromium layout and flow checks, pg_dump restore.
