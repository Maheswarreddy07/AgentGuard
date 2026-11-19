FROM python:3.12-slim
WORKDIR /srv
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app backend/app
COPY backend/alembic backend/alembic
COPY backend/alembic.ini backend/alembic.ini
COPY benchmarks benchmarks
RUN pip install --no-cache-dir ./backend
WORKDIR /srv/backend
ENV AUTO_CREATE_TABLES=0 FORWARDED_ALLOW_IPS="*"
RUN useradd --system --uid 10001 --no-create-home agentguard && mkdir -p /srv/data && chown -R agentguard /srv
USER agentguard
EXPOSE 8000
HEALTHCHECK --interval=15s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
