# API (OpenAPI at /docs)
Every endpoint except `/health` and `/api/v1/auth/status|setup|login` needs `Authorization: Bearer <session token or ag_ API key>` (unless the server runs with `AUTH_REQUIRED=0`). API keys may only call the two trace-ingest endpoints.

New in this version: `/api/v1/auth/*` (status, setup, login, logout, me, change-password), `/api/v1/users` (admin), `/api/v1/api-keys` (admin), `PUT /api/v1/settings` + `POST /api/v1/settings/cleanup` (admin), `/api/v1/history/activity` and `/api/v1/history/benchmarks`, `GET /api/v1/scenarios/template`.

| Method | Path | Notes |
|---|---|---|
| GET | /health | DB check |
| POST | /api/v1/traces | `{trace_id, events[]}` (max 500) → 201 `{accepted, duplicates}` |
| POST | /api/v1/traces/{id}/events | append events → 202 |
| GET | /api/v1/traces | filters: `agent,status(clean\|flagged),severity,category,q,date_from,date_to`, `sort(newest\|severity\|events)`, `limit,offset`; each item carries status, max severity, categories, headline |
| GET | /api/v1/traces/facets | counts by status/severity/category/agent for filter UIs |
| GET | /api/v1/traces/{id}/recovery-plan | what AgentGuard *would* do and why; executes nothing |
| POST | /api/v1/demo/seed | load synthetic demo traces (idempotent) |
| GET | /api/v1/meta | plain-English labels for categories, actions and metrics |
| GET | /api/v1/benchmark-compare?a=&b= | metric deltas between two completed runs |
| GET | /api/v1/scenarios/{id} | full scenario with events and labels |
| GET | /api/v1/traces/{id} | redacted events |
| GET | /api/v1/traces/{id}/analysis | deterministic findings + localization |
| POST | /api/v1/traces/{id}/analyze | same + optional AI hypothesis |
| POST | /api/v1/traces/{id}/recover | `{sim:{...}}` simulation only; appends a recovery_attempt event |
| POST | /api/v1/benchmarks/run | `{scenario_ids?, seed}` → 202; poll GET until `completed`/`failed` |
| GET | /api/v1/benchmarks, /{id}, /{id}/results | results 409 until completed |
| GET/POST | /api/v1/scenarios | POST validates and writes `benchmarks/scenarios/custom/` |
| GET | /api/v1/metrics/overview, /metrics/trends, /api/v1/settings, /api/v1/agents | |

Errors always look like `{"error":{"code","message","details?"}}` (404/409/422/429/500); 500 never includes a stack trace. Results accept `?only=mistakes`.
```bash
curl -s -XPOST localhost:8000/api/v1/benchmarks/run -H 'content-type: application/json' -d '{"seed":0}'
```


## Added in v0.4 (all need a session token or an `agent` API key where noted)
| Method | Path | Notes |
|---|---|---|
| POST | /api/v1/runtime/check | **agent key or member+**. Before-the-tool decision: `{allowed, effective, reason, matches, risk, approval_request_id}` |
| GET/POST/PUT | /api/v1/policies, /policies/{id} | admin writes; versioned. `POST /policies/{id}/toggle`, `/rollback` |
| GET | /api/v1/policies/templates, /policies/evaluations | form specs + starter templates; decision log |
| POST | /api/v1/policies/test, /policies/simulate | what-if; change nothing |
| GET | /api/v1/approvals, /approvals/{id} | agent key may read one; humans see evidence |
| POST | /api/v1/approvals/{id}/decision | member+; reject/changes need a note |
| GET | /api/v1/risk/predictions, /risk/metrics, /risk/monitor | |
| GET | /api/v1/findings | filter by severity, category, trace, source |
| GET/POST | /api/v1/agents | registry |
| GET | /api/v1/traces/compare, /traces/{id}/export | |
| POST | /api/v1/workspaces | first workspace's admins only |
| POST | /api/v1/api-keys/{id}/rotate | admin |
