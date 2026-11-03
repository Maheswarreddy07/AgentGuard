# Risk prediction

Code: `backend/app/risk/engine.py`. A transparent, rule-based score from 0 to 100 — **not a trained model**. Every point comes from a named signal with a stated weight, and the response lists them.

| Signal | Max points | Predicts |
|---|---|---|
| intended action breaks a rule (no prior step / no approval / over a limit / bad arguments) | 60 | workflow, unauthorized, goal constraint, invalid arguments |
| consecutive tool failures | 60 | repeated failures |
| same call already succeeded and is about to repeat | 55 | repeated calls |
| repeating 2–3-call cycle | 55 | going in circles |
| budget ≥70% used | 55 | budget exceeded |
| injection-like text in context + consequential next step | 55 | prompt injection |
| three different requests, identical answers | 50 | going in circles |
| unresolved contradiction | 25 | unsupported success claim |
| recent failure rate; unresolved error | 15 each | tool failure; unsupported success claim |

Level: <25 low, <50 medium, <75 high, ≥75 critical. **Confidence** is an ordinal label from how many independent signals agree (1 = low, 2 = medium, ≥3 = high), not a probability. A warning is stored when the score first reaches the alert threshold (default 50, adjustable in Settings) for each predicted failure.

**Predictions are tracked.** After the run, each warning is marked *occurred* (a finding of that type becomes detectable at or after the warning step), *not occurred*, or *pending*. `/risk/metrics` reports precision, recall, average lead steps, the share warned before the failing step, and the false-intervention rate (high/critical warnings that never came true), always with sample counts.

**Honest limits** (also in evaluation.md): on the synthetic benchmark early-warning precision is ≈88% and recall ≈44%. A first-ever tool failure cannot be predicted, and the engine only reasons at tool calls, so budget breaches inside a model call and false success claims are not warned about in advance. The weights were adjusted after looking at benchmark results.
