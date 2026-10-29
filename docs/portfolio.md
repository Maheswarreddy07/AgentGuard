# Portfolio kit

## 3-minute demo script
1. (0:00) Problem: agents fail silently; API monitoring misses it. Show Overview: live vs *synthetic benchmark* badges.
2. (0:30) Traces → open a trace with an unsupported success claim. Show highlighted evidence, origin vs first-detectable vs observed.
3. (1:15) Click *Run safe recovery simulation*; show a consequential action escalates instead of retrying.
4. (1:45) Benchmark Lab → run → show baseline vs protected, CIs, and the false negatives list. Say plainly what is synthetic.
5. (2:30) Show the SDK snippet (5 lines) and one limitation: detection depends on declared schemas/flags.

## Resume bullets (fill from your own `latest.json`; do not quote numbers you have not reproduced)
- Built AgentGuard, a FastAPI/React platform that detects [N] classes of AI-agent failure from execution traces with deterministic rules, localizing the earliest detectable event.
- Designed a recovery policy that never retries consequential actions; in a synthetic benchmark of [N] scenarios it raised safe-outcome rate from [X]% to [Y]% (95% CI [..]).
- Authored a reproducible evaluation harness (seeded scenarios, separated ground truth, bootstrap CIs) and used adversarial cases to find and fix a retry-loop detector bug.

## Interview Q&A
- *Why deterministic rules, not an LLM?* Verifiable, testable, free, works offline; the LLM is optional and only produces labelled hypotheses.
- *Is 100% detection on your template scenarios meaningful?* No: same author as the detectors. That is why there are adversarial cases and a limitations section.
- *How do you prevent prompt injection in diagnosis?* Trace text goes only in a delimited data block under a fixed system prompt, output is schema-validated, cited ids must exist, and output never triggers actions.
- *Origin vs detectable?* In a contradiction the first bad result is the origin; it is only detectable when the conflicting second result arrives. My first localizer conflated them (88.8% accuracy) — a benchmark found it.
- *What would you do next?* Independently authored scenarios, real agent traces, calibrated confidence, auth, live recovery adapters with permissions.

## Screenshots
Not included (no browser in the build sandbox). Run the app, then capture Overview, a trace investigation and Benchmark Lab into `docs/screenshots/` and link them here.
