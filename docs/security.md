# Security notes
**Implemented**
- Sign-in with email + password. Passwords are stored as PBKDF2-HMAC-SHA256 hashes (600,000 iterations, per-user salt); minimum length is configurable.
- Server-side sessions: random 256-bit tokens, only their SHA-256 hash is stored, expiry (default 12 h), revocable. Logging out, changing a password, disabling a user or resetting a password invalidates sessions.
- Brute-force protection: repeated failures lock the account for a configurable time; the error message is identical for unknown emails and wrong passwords, and unknown emails cost the same time (no account enumeration).
- Roles (viewer / member / admin) enforced on the server for every endpoint; agents use API keys that can only ingest traces. Keys are shown once and stored hashed.
- The last active admin cannot be removed or demoted.
- Audit log of sign-ins, user/key/settings changes, benchmark runs and recovery simulations; the security part is admin-only.
- First-run setup only works while there are zero users.
- Secrets via env; payload/size limits; redaction of keys/emails/SSNs before storage; CORS allow-list; request rate limiting; generic 500 errors; consequential actions never auto-retried and recovery is simulation-only.

**Not implemented / limits**
- No SSO, 2FA, email verification or self-service password reset.
- The browser keeps the session token in local storage, so an XSS bug would expose it (there is no strict Content-Security-Policy yet).
- Rate limiting is in-memory per process and keyed by client IP (behind a proxy this is the proxy’s IP).
- No LLM prompt-injection defences have been exercised against a live model.
- Serve over HTTPS in any real deployment. This is not production-certified.
