# System architecture

```mermaid
flowchart LR
  A[Agent + SDK] -->|1 check before each tool| RT[Runtime check]
  RT --> PE[Policy engine] & RK[Risk engine]
  PE -->|REQUIRE_APPROVAL| AP[Approval queue] --> H((Human))
  A -->|2 events| ING[Ingestion: scan, redact, store]
  ING --> DB[(SQL database)]
  DB --> DET[Detectors x15] --> LOC[Localization]
  DB --> RK
  DET --> FIND[(Findings)]
  RK --> PRED[(Risk predictions + outcomes)]
  SC[Scenarios] --> BM[Benchmark runner] --> DB
  UI[React dashboard] --> API[FastAPI /api/v1]
  API --> DB
```

Modular monolith: `app/api` (routes), `app/detectors`, `app/risk`, `app/runtime` (policy engine), `app/recovery` (simulated), `app/evaluation` (benchmark), `app/services`, `app/db`. Everything is scoped by workspace. The runtime check is the only synchronous path an agent waits on; it reads the run's stored events, evaluates policies and risk, records a `policy_check` (and `risk_detected`) event, and returns allow / not allowed with a reason. Detection, risk replay and the cached run summary are recomputed on every ingest.
