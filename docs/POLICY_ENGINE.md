# Policy engine

Policies are deterministic and need no model. Code: `backend/app/runtime/policy_engine.py`.

A policy = **scope** (agents, tools) + **condition** + **action** + severity + message. The API describes every condition's form fields (`GET /policies/templates` → `condition_specs`), and the UI renders the form from that.

| Condition | Matches when |
|---|---|
| `tool_denylist` / `tool_allowlist` | the tool is on / is NOT on the list |
| `argument_compare` | an argument (dotted path allowed) meets `gt gte lt lte eq ne in not_in contains regex` |
| `tool_call_count_above` | this call would exceed a limit (optionally per tool) |
| `duplicate_call` | an identical call (same tool and arguments) already succeeded in this run |
| `requires_prior` | another tool has not yet succeeded in this run |
| `missing_approval` | the call is consequential and has no valid approval |
| `budget_exceeded` | tool calls / steps / tokens / cost / duration would exceed a limit |
| `sensitive_in_arguments` | arguments contain email / ssn / card number / secret key |
| `actor_role_not_in` | the run's actor role is not allowed |

**Decisions** (strongest wins): `BLOCK` > `REQUIRE_APPROVAL` > `DEFER` > `WARN` > `ALLOW`. **Modes:** observe → effective ALLOW; warn → anything stronger becomes WARN; enforce → as decided. An approval satisfies `REQUIRE_APPROVAL` policies, **never** `BLOCK`.

**Reproducible and auditable:** every evaluation is stored (`policy_evaluations`) with the policy version, the redacted arguments and the history size it saw. Policies are versioned; editing creates a version; rollback creates a *new* version copying an old one. `POST /policies/test` evaluates a draft against a synthetic call; `POST /policies/simulate` replays a draft or saved policy over recent real tool calls without changing anything.

Only admins can create, edit, enable/disable or roll back policies.
