import os
from alembic import context
from sqlalchemy import create_engine
from app.db.models import Base

url = os.getenv("DATABASE_URL", "sqlite:///./agentguard.db")
if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(url).connect() as conn:
        context.configure(connection=conn, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
