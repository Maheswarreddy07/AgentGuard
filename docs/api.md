# API (OpenAPI at /docs)
| Method | Path | Notes |
|---|---|---|
| GET | /health | DB check |
| POST | /api/v1/traces | `{trace_id, events[]}` (max 500) → 201 `{accepted, duplicates}` |
| POST | /api/v1/traces/{id}/events | append events → 202 |
| GET | /api/v1/traces?agent=&limit=&offset= | paginated |
| GET | /api/v1/traces/{id} | redacted events |
| GET | /api/v1/traces/{id}/analysis | deterministic findings + localization |
| POST | /api/v1/traces/{id}/analyze | same + optional AI hypothesis |
| POST | /api/v1/traces/{id}/recover | `{sim:{...}}` simulation only; appends a recovery_attempt event |
| POST | /api/v1/benchmarks/run | `{scenario_ids?, seed}` → 202; poll GET until `completed`/`failed` |
| GET | /api/v1/benchmarks, /{id}, /{id}/results | results 409 until completed |
| GET/POST | /api/v1/scenarios | POST validates and writes `benchmarks/scenarios/custom/` |
| GET | /api/v1/metrics/overview, /metrics/trends, /api/v1/settings, /api/v1/agents | |

Errors: 404/409/422 with `detail`; 429 `{"error":{"code":"rate_limited"}}`; 500 never includes a stack trace.
```bash
curl -s -XPOST localhost:8000/api/v1/benchmarks/run -H 'content-type: application/json' -d '{"seed":0}'
```
