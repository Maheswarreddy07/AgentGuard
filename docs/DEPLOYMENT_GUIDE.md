# Deployment (not verified live)
1. Provision PostgreSQL. Set `DATABASE_URL=postgresql+psycopg://...`, `AUTO_CREATE_TABLES=0`, `CORS_ORIGINS=<frontend origin>`, optional `RETENTION_DAYS`, `RATE_LIMIT_PER_MIN`.
2. Backend: build `backend/Dockerfile` from the repo root (it runs `alembic upgrade head` then uvicorn; health check on `/health`). Any container host works (Render, Fly.io, Railway).
3. Frontend: `cd frontend && VITE_API_URL=https://your-api npm run build`, serve `dist/` from any static host, or use `frontend/Dockerfile` (nginx proxies `/api`).
4. Put the API behind HTTPS. There is no authentication: do not expose write endpoints publicly without adding it.
Local all-in-one: `docker compose up --build`.
