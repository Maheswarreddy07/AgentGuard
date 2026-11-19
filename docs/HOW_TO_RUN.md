# How to run AgentGuard (Windows PowerShell)

## 1. Backend (terminal 1)
```
cd D:\agentguard\agentguard\backend
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head          # adds/updates database tables (safe to repeat)
uvicorn app.main:app --reload --port 8000
```
Check: open http://localhost:8000/health — it should answer `ok`.
First visit to the app asks you to create the admin account.

## 2. Frontend (terminal 2)
```
cd D:\agentguard\agentguard\frontend
npm install
npm run dev
```
Open http://localhost:5173 . The dev server forwards /api to port 8000.

## 3. Check everything
```
cd backend;  python -m pytest -q
cd ..\sdk;  python -m pytest -q
cd ..\frontend;  npx vitest run;  npm run build
```

## Optional: run the tests on PostgreSQL
```
$env:TEST_DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/agentguard_test"   # an EMPTY test database; its tables are dropped
cd backend; python -m pytest -q
```

## Notes
- Restart the backend after pulling changes (new columns / wording are read at start-up).
- Only real data is shown. Nothing is auto-seeded. Test runs are synthetic and labelled so.
- Production: set `AUTH_REQUIRED=1`, a strong `SECRET`/`AUTH_*` values, `DATABASE_URL` (PostgreSQL), and `CORS_ORIGINS` to your site. Docker/PostgreSQL were not verified here.
