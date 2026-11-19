import os
# Legacy API tests run with auth off; test_auth.py turns it on explicitly. Fast password hashing for tests.
os.environ.setdefault("AUTH_REQUIRED", "0")
os.environ["AUTH_PBKDF2_ITERATIONS"] = "1000"


from fastapi.testclient import TestClient as _TestClient

class AllDataClient(_TestClient):
    """For tests that use demo runs on purpose: every GET asks for data=all unless the test says otherwise. Production views are tested in test_data_scope.py."""
    def request(self, method, url, **kw):
        if method.upper() == "GET" and "data=" not in str(url): url = str(url) + ("&" if "?" in str(url) else "?") + "data=all"
        return super().request(method, url, **kw)


# Run the whole suite on a real database: TEST_DATABASE_URL=postgresql+psycopg://... python -m pytest
# Every test that asks for an in-memory SQLite database gets a freshly emptied schema on that server instead.
import pytest as _pytest

@_pytest.fixture(autouse=True)
def _real_database_when_asked(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        return
    import app.main as main
    from sqlalchemy import create_engine
    from app.db.models import Base
    real = main.make_engine
    def make(u=None):
        if u is not None and str(u).startswith("sqlite") and ":memory:" in str(u):
            e = create_engine(url); Base.metadata.drop_all(e); e.dispose()
            return real(url)
        return real(u)
    monkeypatch.setattr(main, "make_engine", make)
