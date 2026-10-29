# Architecture

```mermaid
flowchart LR
  A[Agent + SDK] -->|events| API[FastAPI /api/v1]
  API --> R[Redaction] --> DB[(SQLAlchemy: SQLite/PostgreSQL)]
  DB --> D[Detectors x10] --> L[Localization]
  D --> P[Recovery policy] --> S[Simulated executor]
  D -.optional, redacted evidence only.-> LLM[LLM diagnosis: hypothesis only]
  SC[Scenarios JSON/YAML] --> B[Benchmark runner] --> M[Metrics + bootstrap CI] --> DB
  UI[React dashboard] --> API
```
Data flow: events are validated (Pydantic), redacted, stored idempotently by `(trace_id, event_id)`, read back sorted by `step_index`. Detectors are pure functions `events -> findings`. Localization reports origin, first detectable and last observed events and returns *unresolved* when it cannot tell. The recovery policy sees only events and findings; ground truth never reaches it. Executors are simulations; consequential actions always escalate.
