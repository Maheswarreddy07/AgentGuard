# Database

* **What is stored:** agents, runs and their steps, findings, risk predictions, safety rules and their versions, rule decisions, approvals, people, API keys (hashed) and the audit log. Admin console → Database shows the engine, schema version, size and row counts.
* **Schema changes** go through Alembic (`alembic upgrade head`). `AUTO_CREATE_TABLES=1` is for a laptop; production uses `0` and runs the migrations.
* **Keeping it small:** Settings → “keep runs for N days”, and Admin console → Tidy up → “Delete runs older than the keep-for setting”. “Remove demo and sample data” clears runs made by demo data, sample agents and the starter file.
* **Deleting** a run removes everything that belongs to it (steps, findings, predictions, rule decisions, approvals, recoveries). Retention uses the same code, so old runs no longer leave findings behind.
* **Backups:** with SQLite, Admin console → Database → “Download a backup” gives a consistent copy that is safe to take while AgentGuard is running. With PostgreSQL use `pg_dump` on a schedule; keep copies off the server and test a restore.
* **Not verified here:** PostgreSQL and a restore from a backup have not been tried by the people who built this. Try both in staging first.
