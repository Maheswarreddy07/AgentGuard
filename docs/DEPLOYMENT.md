# Deployment checklist

Status: the code, migrations (0001–0006) and API are tested on SQLite **and on a real PostgreSQL 16** (all backend tests pass on both; a `pg_dump` backup restored into a new database had identical row counts). The UI was checked in a real Chromium (desktop, tablet, phone widths). **Not verified:** building the Docker images, running Docker Compose, TLS/proxy set-up and a live deployment on your infrastructure.

1. Use PostgreSQL: set `DATABASE_URL`, set `AUTO_CREATE_TABLES=0` and run `alembic upgrade head`.
2. Keep `AUTH_REQUIRED=1`. Create the first admin through the setup screen, or set `ADMIN_EMAIL` and `ADMIN_PASSWORD` once.
3. Put HTTPS in front (a reverse proxy or load balancer). Set `CORS_ORIGINS` to the exact address people use and `PUBLIC_API_URL` to the address agents use.
4. The frontend container ships with security headers (see `frontend/nginx.conf`). If you serve the frontend elsewhere, copy them.
5. Back up the database (see docs/DATABASE.md). Agent API keys are stored hashed; a lost key cannot be recovered, only replaced.
6. Run `npm test`, `npm run build`, and in `backend/` `python -m pytest` before every release.
7. Optional smoke check against a running backend: `frontend/scripts/smoke.test.jsx` (see the comment at the top of the file).

Known limits: see docs/LIMITATIONS.md. Page wording is served by the backend (docs/ROLES_AND_ACCESS.md).

## Before going live (checklist)
- `cp .env.example .env` and set `POSTGRES_PASSWORD` (Compose refuses to start without it), `CORS_ORIGINS` (your exact site address) and `ADMIN_EMAIL`/`ADMIN_PASSWORD` for the first admin (remove them afterwards).
- Only the web container is published; the backend is reachable only through it, so client addresses (used for rate limits) cannot be spoofed. Do not publish port 8000 yourself.
- Put HTTPS in front of the web container. Add `Strict-Transport-Security` there once HTTPS works.
- Rate limits: each API key / login session has its own allowance (`RATE_LIMIT_PER_MIN`, default 600/min); the client address gets 10x that as a backstop. Unsigned requests (login attempts) are limited per address.
- Writes can be made retry-safe: send an `Idempotency-Key` header and a repeated request returns the first answer instead of repeating the write (kept 24 hours).
- Test runs execute inside the server process: at most 3 at a time; a run left "running" after a restart is marked failed after 10 minutes. For heavy use, run a second backend instance dedicated to tests or move runs to a worker (not built).
- Backups: `pg_dump -Fc -h <host> -U agentguard agentguard > backup.dump`; restore into an empty database with `createdb agentguard_restored && pg_restore -d agentguard_restored backup.dump`, then `alembic current` should show the same version. Test a restore before you need one.
- Recovery that really runs lives in the SDK (`RecoveryExecutor`, `Run.call_tool_with_recovery`): consequential tools are never retried or auto-corrected. The server-side benchmark recovery is still a simulation and is labelled as such.
