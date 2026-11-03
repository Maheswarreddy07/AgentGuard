# Failure detection

Code: `backend/app/detectors/rules.py`. Pure functions over a run's events; each can be turned off in Settings. Each finding records its rule, severity (info → critical), evidence event ids and lines, and a confidence (1.0 = the rule's condition was verified; <1.0 = a heuristic with a stated strength).

| Category | Rule | How |
|---|---|---|
| Invalid tool arguments | `invalid_args` | call inputs vs a declared `arg_schema` |
| Tool failure | `tool_failure` | error results |
| Retry loop | `retry_loop` | N consecutive identical failures (adjustable) |
| Repeated calls | `repeated_calls` | same call succeeded N times; near-duplicates only when differing values are long free text ≥90% similar (ids and numbers are never "near") |
| Loops / no progress | `loop_detected` | a 2–3-call block repeated 3×; four identical answers to different requests (heuristic) |
| Contradictory results | `contradiction` | two OK results for one entity disagree |
| Missing evidence | `missing_evidence` | required tools never succeeded before the run ended |
| Workflow violation | `workflow_invariant` | `must_precede` rules |
| Goal constraint | `goal_constraint` | explicit limits on a tool's inputs |
| Unsupported success | `unsupported_success` | claims success while a tool's latest result is an error |
| Unauthorized action | `unauthorized_action` | consequential call without a prior matching human approval |
| Resource exhaustion | `resource_exhaustion` | budget on the run (calls, steps, tokens, cost, time) |
| Sensitive data | `sensitive_exposure` | sensitive data sent to an `external` tool or shown in the final response (found at ingestion, before redaction; only labels are stored) |
| Prompt injection | `injection_indicators` | instruction-like text in a tool result; HIGH if the next call uses a tool named in it (heuristic) |
| Incomplete run | `incomplete` | no end event |

**What it depends on:** the instrumentation must declare schemas, required tools, constraints, budgets, `consequential` and `external` flags. Undeclared problems are not detected (see `adv-09`, `adv-10`). Known false alarm: two reads of one entity that differ only in a timestamp (`adv-02`).
