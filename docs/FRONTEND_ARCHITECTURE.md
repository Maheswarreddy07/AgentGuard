# Frontend architecture

Plain JavaScript (ES6+) with JSX, React, Vite and Recharts. **No TypeScript** — there are no `.ts`/`.tsx` files, interfaces or type definitions (a test enforces this). Navigation uses a small hash router (`src/router.js`); there is no Tailwind or React Router in this project.

```
src/
  api/            ← the ONLY code that talks to the backend
    client.js       fetch wrapper, token storage, 401 handling, file download
    endpoints.js    every URL in one place: `paths.*` (reads) and `*Api.*` (writes)
    index.js        re-exports client + endpoints + hooks
  hooks/          useApi (load a GET), usePolling, context (meta, auth, label helpers)
  config/         navigation.js — the sidebar and page titles as data
  components/     presentational components: props in, callbacks out, no API imports
  pages/          containers: call hooks/endpoints, hold page state, hand data to components
  ui.jsx          small primitives (Card, Kpi, Chip, Tabs, Toggle, Drawer, toasts, MiniStrip…)
  App.jsx         auth gate + shell (AppSidebar + PageHeader + routed page)
```

## Rules (enforced by `src/test/architecture.test.js`)
1. No TypeScript files or type declarations.
2. Components and pages contain no `/api/v1` URLs and no `fetch(`; `fetch` appears only in `api/client.js`.
3. Components never import the API layer.
4. All 16 required reusable components exist.

## Reusable components
`AppSidebar`, `PageHeader`, `HealthSummary`, `AgentCard`, `AgentTable`, `ProblemCard`, `ProblemDetails`, `ActivityTimeline`, `SafetyRuleCard`, `ApprovalCard`, `ScenarioCard`, `BenchmarkComparison`, `EmptyState`, `LoadingState`, `TechnicalDetails`, `IntegrationWizard` — plus `Flow` (run timeline) and `BenchExtras` (risk and split tables).

## Where each feature lives
| Feature | Page → components → API |
|---|---|
| Health, KPIs, charts | `Overview` → `HealthSummary`, `BenchmarkComparison` → `paths.overview/trends` |
| Agents | `Agents` → `AgentCard`/`AgentTable` → `paths.agents` |
| Runs & investigation | `Traces`, `TraceDetail` → `Flow`, `ProblemDetails`, `TechnicalDetails` → `paths.traces/trace/analysis`, `runApi` |
| Problems | `Problems` → `ProblemCard`, `ProblemDetails` → `paths.findings/finding` (`GET /findings/{id}` was added for this) |
| Risk | `Risk` → `paths.riskMonitor/riskMetrics/riskPredictions` |
| Safety rules (policies) | `Policies` → `SafetyRuleCard` → `policyApi`, `paths.policies*` |
| Approvals | `Approvals` → `ApprovalCard` → `approvalApi` (polls every 8 s) |
| Scenarios / benchmark | `Scenarios` → `ScenarioCard`; `Bench` → `BenchmarkComparison` → `scenarioApi`, `benchmarkApi` |
| Activity | `History` → `ActivityTimeline` → `historyApi` |
| Connect an agent | `Integrations` → `IntegrationWizard` → `agentApi`, `teamApi.createKey`, `paths.settings/agents` |
| Settings, team, API keys (with rotation), account | `Settings` → `settingsApi`, `teamApi`, `authApi` |

## Adding a page or a call
Add the route to `config/navigation.js`, the URL to `api/endpoints.js`, a presentational component in `components/`, and a container in `pages/`. Never put a URL in a component.
