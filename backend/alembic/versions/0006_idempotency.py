"""idempotency keys: a retried write returns the first answer instead of repeating the write"""
from alembic import op
from app.db.models import IdempotencyRow

revision, down_revision = "0006", "0005"

def upgrade():
    IdempotencyRow.__table__.create(op.get_bind(), checkfirst=True)

def downgrade():
    IdempotencyRow.__table__.drop(op.get_bind(), checkfirst=True)
