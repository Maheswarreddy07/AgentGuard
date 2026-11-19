"""Where the database is. DATABASE_URL wins if set. Otherwise the parts (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT) are put together here,
so a password may contain any character (@ : / # % ...) without being pasted into a URL by hand. Falls back to a local SQLite file."""
import os
from sqlalchemy.engine import URL


def database_url() -> str:
    if os.getenv("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    host = os.getenv("DB_HOST")
    if host:
        return URL.create("postgresql+psycopg", username=os.getenv("DB_USER", "agentguard"), password=os.getenv("DB_PASSWORD") or None, host=host,
                          port=int(os.getenv("DB_PORT", "5432")), database=os.getenv("DB_NAME", "agentguard")).render_as_string(hide_password=False)
    return "sqlite:///./agentguard.db"
