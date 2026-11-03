# Database schema (SQLAlchemy 2.x; migrations 0001–0004)

| Table | Purpose / key |
|---|---|
| `workspaces` | tenants |
| `users` (+ `workspace_id`), `sessions`, `api_keys` (+ `workspace_id`, SHA-256 hashed, rotatable) | auth |
| `agents` | registry; unique (workspace, name) |
| `traces` | one run; **primary key (workspace_id, trace_id)**; cached summary (status, severity, categories, outcome, mode, task, duration, tokens, cost, risk, blocked, recoveries) |
| `events` | one row per event; FK (workspace_id, trace_id); unique (workspace, trace, event_id); payload is the redacted event |
| `findings` | detector output; stable id; rule, confidence, source, evidence |
| `risk_predictions` | warnings with signals and the later outcome / lead steps |
| `policies`, `policy_versions`, `policy_evaluations` | rules, their versions, and every decision with its inputs |
| `approval_requests` | pending/decided approvals; args hash; single-use flag; expiry |
| `recovery_attempts` | table exists; not used yet |
| `benchmark_runs` | async benchmark jobs and results (JSON) |
| `audit_log` | activity and security history |
| `app_settings` | per-workspace overrides; key (workspace_id, key) |

Events keep a JSON `payload` (the full redacted event) because event shapes vary; everything that is queried or aggregated is in typed columns. Databases created before workspaces existed are upgraded in place (rows kept) by `app/db/upgrade.py`, which both the dev auto-upgrade and migration 0004 use.
