# Security notes
Implemented: secrets via env, payload/size limits, key/email/SSN redaction before storage, CORS allow-list, generic 500 errors (no stack traces), consequential actions never auto-retried and always escalate, recovery is simulation-only, scenario-id validation.
Not implemented: authentication, rate limiting, retention enforcement, LLM prompt-injection defences (no LLM is wired in). This is not production-certified.
