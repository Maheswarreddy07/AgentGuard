# AgentGuard audit (steps 1 to 4 of the production-readiness brief)

Scope of this report: the full audit, the fake/demo data and metric-integrity findings, the backend repairs, and the benchmark verification. Steps 5 to 16 (new navigation, Simple/Advanced mode, the page redesigns, regression-from-production) are **not done yet**; see the last section.

## 1. Feature audit

| Area | State | Evidence |
|---|---|---|
| Authentication, roles, lockout, sessions | Fully implemented and tested | `tests/test_auth.py` |
| Workspace isolation (runs keyed by workspace + trace id) | Fully implemented and tested | `tests/test_runtime_api.py` isolation tests |
| API keys (hashed, rotatable, revocable) | Fully implemented and tested | `tests/test_auth.py` |
| Rate limiting, CORS from env, secure error shape | Implemented; limits are per-minute global, not per key | `main.py` middleware, `tests/test_features.py` |
| Ingestion with scan-then-redact | Fully implemented and tested | `app/redaction.py`, ingest tests |
| 15 rule-based detectors | Implemented and tested **on synthetic data only** | `app/detectors` |
| Risk score | Implemented; rule-based, **not** a trained model (and labelled so) | `app/risk/engine.py` |
| Policy engine, versions, simulate | Fully implemented and tested | `tests/test_risk_policy.py` |
| Approvals: single-use, argument-bound, expiring | Fully implemented and tested | `tests/test_runtime_api.py` |
| An approval never overrides a block rule | Fully implemented and tested (engine and API) | `test_approval_never_overrides_a_block`, `test_approval_satisfies_approval_policies_but_never_a_block` |
| Pre-execution check API / SDK fail-closed | Fully implemented and tested | SDK tests |
| Recovery | **Only simulated**: `app/recovery/policy.py` decides, and a scripted executor decides the outcome from the scenario's `sim` values. There is no engine that performs and verifies recoveries on a real agent | `app/recovery/policy.py` |
| Failure localization | Implemented; no downstream-impact or cause classification | `app/localization` |
| Benchmark runner and metrics | Implemented; see sections 3 and 4 | `app/evaluation` |
| Production failure to regression scenario | **Missing** (the scenario `source: "trace"` exists, no conversion workflow) | none |
| Replay a regression against an updated agent | **Missing** | none |
| AI-assisted diagnosis | Implemented, optional; never tested against a live provider | `services/diagnosis.py` |
| Delete, database status, SQLite backup | Implemented and tested | `tests/test_auth.py` |
| Data retention | Implemented; now deletes everything that belongs to a run | `services/retention.py` |
| Simple/Advanced mode, top navigation with the six sections | **Missing** (a top bar with a menu exists; the six-section layout does not) | none |

## 2. Fake, demo and mixed data

| Finding | Severity | Fixed? |
|---|---|---|
| "Load demo data" wrote synthetic runs into the **same workspace and tables as real activity**, and every dashboard counted them | Critical | **Yes.** Every run and agent now has an `origin` (production, demo, sample, starter). All dashboards, lists, problems, risk and approval views default to production only. Demo, sample and starter runs are visible only through an explicit, labelled "Demo data" view. Existing databases are migrated (`0005`, plus an in-place upgrade) |
| "Try a sample agent" and the starter file's test run created agents and runs that looked real | Critical | **Yes.** Same mechanism. An agent that exists only because of sample runs is hidden from production |
| Nothing is hardcoded in the dashboards: Overview, trends, agents, risk and problems are all computed from stored rows | Verified, no fix needed | grep and endpoint review |
| No seeded fake agents exist in code (`payment-agent` and `orders-agent` in a screenshot came from a local database) | Verified | grep |
| The checked-in `benchmarks/results/latest.json` and the README/docs tables quoted numbers for a 189-scenario library | Misleading | **Yes.** Regenerated and re-rendered from the corrected library |
| Demo workspace is an isolated *view* in the same database, not a separate workspace | Limitation | Documented, not changed |

## 3. Scenario library and benchmark integrity

| Finding | Effect | Fixed? |
|---|---|---|
| 189 built-in scenario files contain only **128 distinct tests**: 23 are exact repeats inside a split and **38 appear in more than one split** | Counts were overstated by 48%; the Scenarios page showed the same card up to 7 times | **Yes.** The loader keeps one copy of each distinct test (`signature()` of events plus labels) |
| **Leakage:** 20 of the 39 "test" scenarios were identical to dev/validation scenarios, so the held-out set was not held out | The "test" figures were inflated | **Yes.** When a test appears in several splits the copy in the most-tuned split is kept. The test split is now **19 scenarios** and is flagged as small |
| The "agent without AgentGuard" baseline (27%) is **not a measurement**: a scenario labelled with a failure is a failed run by construction, so the baseline is just the share of clean scenarios | The "27% to 95%" headline compared a constant with a simulation | **Labelled, not removed.** Every run now carries `baseline_is_constructed` and a plain definition |
| Recovery (66%) is a **simulation** against the scenario's scripted world, not a verified recovery | | **Labelled** as simulated in the result label |
| Benchmark rules were written while looking at these scenarios | Detection scores are consistency checks, not generalisation | Documented caveat kept in `docs/evaluation.md` |
| No dataset version, detector version, AgentGuard version or run timestamp on a result | Runs could not be audited | **Yes.** Each result stores dataset name, kind, hash, scenario-set hash, counts per split, detector version, AgentGuard version, configuration and time |
| Runs on different scenario sets could be "compared" | Meaningless deltas | **Yes.** The compare endpoint now refuses (409) unless scenario set and detector version match |
| No sample sizes next to a score; categories with 1 or 2 cases looked as solid as large ones | | **Yes.** Every denominator is returned, 95% Wilson intervals are returned for precision, recall, false-positive rate, localization and recovery, and `sample_warnings` lists groups with fewer than 10 cases |
| Zero denominators | Already returned null for precision/recall/FPR/localization/recovery; the UI shows "n/a" | Verified and now covered by tests |
| Detectors only receive `events`; labels are never passed to them | Correct | Verified (`Scenario` model comment, runner) |

### Recomputed figures (synthetic-v1, 128 distinct scenarios, seed 0)
Task success without protection 32.0% (by construction), with 43.0%. Safe outcome without 32.0% (by construction), with 93.0%. Detection precision 99.1% (112 flags), recall 98.2% (113 failures), false-positive rate 2.4% (1 of 41 clean runs), localization 97.7% (87 labelled), simulated recovery 66.7% (24 attempts). Test split: 19 scenarios. These are synthetic and the rules were tuned on similar scenarios, so they say nothing about real agents.

## 4. How every figure is calculated
* Precision = TP / (TP + FP); recall = TP / (TP + FN); F1 = 2PR / (P + R); micro = pooled over all (scenario, category) pairs, macro-F1 = mean of per-category F1 over categories that have data.
* False-positive rate = clean scenarios with any flag / clean scenarios.
* Localization = flagged step equals labelled step / scenarios that have a labelled step.
* Recovery success = simulated recoveries that verified / scenarios where recovery was eligible.
* Task success and safe outcome = counted over all scenarios in the run; "safe" is defined in the result (`safe_outcome_definition`).
* Any ratio with a zero denominator is `null`, shown as "n/a".
* Home and list pages (production): runs, flagged runs, severities, approvals and risk are counted from stored rows of origin "production". Nothing is estimated.
* The risk "reliability" figures (warnings that came true, head start) come from stored predictions matched to later findings; small samples are shown with their counts.

## 5. Security and production readiness
Present: roles, lockout, hashed keys, audit log, redaction, rate limit, env-driven CORS, security headers in the frontend server config, retention, migrations through `0005`, transactions on approvals.
Gaps: rate limit is not per API key; no background-job queue (benchmarks run in-process); idempotency exists for approvals and event ids but not for every write endpoint; PostgreSQL, Docker and a real deployment have never been run; the demo view shares a database with production.

## 6. Progress on the brief
Done: 1 audit, 2 and 3 fake/demo data and metric integrity, 4 benchmark verification (this report); 5 horizontal navigation; 6 Simple/Advanced mode; 7 Home; **8 Agents**, **9 Activity**, **10 Problems**, **11 Safety**:

* **Agents.** Each card shows the connection status (connected, quiet, test run only, waiting for the first run), how it is connected (Python SDK, direct API, starter file, sample runs), its last three runs and how many problems are open. "Quiet" means nothing received for `AGENT_QUIET_DAYS` (7, in `catalog.py`). The integration type is inferred from what the agent sends: the SDK marks its runs, everything else is a direct API call. Table view and environment/risk detail are Advanced mode only.
* **Activity.** A Timeline tab (newest first, grouped by day) built from stored runs, findings, rule decisions (blocked actions, approval requests), approvals and recovery events, with a link to the full run. Nothing is invented: an event appears only if a row for it exists. Recovery events appear only when an agent reports them, because AgentGuard itself does not yet perform real recoveries.
* **Problems.** Grouped Critical (critical and high), Warnings, Resolved. Each answers what happened, why it matters, which agent, what AgentGuard did (stopped the action, held it for approval, tried recovery, warned, or only recorded it, taken from the stored rule decisions) and what to do next. A problem is **Confirmed** when a rule verified it (confidence 1.0) and **Possible risk** when it is a documented heuristic. Members can mark a problem resolved with a note and reopen it; the resolution survives re-analysis of the same run (a changed run produces new problems). Evidence is expandable, open by default in Advanced mode.
* **Safety.** Rules can now be scoped by choosing agents from the connected ones (or adding a name), instead of typing a comma-separated list. Rule creation, editing, activation, block/warn/approval behaviour, approvals with approve/reject/request changes and the decision history already existed. An approval can never override a block rule (tested at engine and API level).

Not done: 12 Test & Improve (three tabs, plain-language test library with difficulty and last result, with/without comparison page), 13 Settings reorganisation, production-to-regression conversion and replay, a real recovery engine, and per-rule effect statistics on the Safety page.
