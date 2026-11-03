"""Runtime settings: defaults come from env/code, admins override them in the DB. The UI renders FIELDS generically."""
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.catalog import RULES
from app.db.models import SettingRow
from app.detectors.rules import ALL_RULES

FIELDS = [
 {"key": "max_retries", "label": "Automatic retries allowed", "group": "safety", "unit": "attempts", "min": 1, "max": 10, "default": 3, "env": None,
  "help": "How many times AgentGuard may retry a failed read-only tool before handing the run to a human. Actions that change things are never retried automatically."},
 {"key": "retry_loop_threshold", "label": "Failures in a row that count as a loop", "group": "detection", "unit": "failures", "min": 2, "max": 10, "default": 3, "env": None,
  "help": "The same tool failing the same way this many times in a row is flagged as a retry loop. Lower = more sensitive."},
 {"key": "duplicate_call_threshold", "label": "Repeated successful calls that count as waste", "group": "detection", "unit": "calls", "min": 2, "max": 10, "default": 3, "env": None,
  "help": "If the same call succeeds this many times, AgentGuard flags that the agent is re-asking for what it already has. Lower = more sensitive."},
 {"key": "risk_alert_threshold", "label": "Risk score that raises a warning", "group": "risk", "unit": "points (0-100)", "min": 10, "max": 100, "default": 50, "env": None,
  "help": "AgentGuard scores how risky a run's trajectory looks (0-100). Scores at or above this raise a predicted-failure warning and are tracked so you can see how often they were right."},
 {"key": "approval_timeout_minutes", "label": "Approval request expires after", "group": "approvals", "unit": "minutes", "min": 1, "max": 10080, "default": 60, "env": None,
  "help": "A request nobody answers in this time is treated as rejected, so a stuck agent can never act on an old, unanswered request."},
 {"key": "rate_limit_per_min", "label": "Request limit per client", "group": "protection", "unit": "requests / minute", "min": 0, "max": 100000, "default": 600, "env": "RATE_LIMIT_PER_MIN",
  "help": "Protects the API from floods. Each IP address may make this many requests per minute. 0 turns the limit off."},
 {"key": "retention_days", "label": "Keep traces for", "group": "data", "unit": "days", "min": 0, "max": 3650, "default": 0, "env": "RETENTION_DAYS",
  "help": "Traces older than this are deleted when the server starts or when you press “Clean up now”. 0 keeps everything."},
]
GROUPS = {"safety": "Recovery safety", "detection": "Detection sensitivity", "risk": "Risk prediction", "approvals": "Human approvals", "protection": "API protection", "data": "Data retention"}

@dataclass(frozen=True)
class Config:
    max_retries: int = 3
    retry_loop_threshold: int = 3
    duplicate_call_threshold: int = 3
    risk_alert_threshold: int = 50
    approval_timeout_minutes: int = 60
    rate_limit_per_min: int = 600
    retention_days: int = 0
    disabled_rules: frozenset = field(default_factory=frozenset)

def default_of(f: dict) -> int:
    v = os.getenv(f["env"]) if f.get("env") else None
    return int(v) if v not in (None, "") else f["default"]

def default_config() -> Config:
    return Config(**{f["key"]: default_of(f) for f in FIELDS})

def _stored(db: Session, ws: int) -> dict:
    return {r.key: r.value for r in db.query(SettingRow).filter(SettingRow.workspace_id == ws)}

def load_config(db: Session, ws: int = 1) -> Config:
    st = _stored(db, ws)
    vals = {f["key"]: int(st[f["key"]]["v"]) if f["key"] in st else default_of(f) for f in FIELDS}
    return Config(**vals, disabled_rules=frozenset(st.get("disabled_rules", {}).get("v", [])))

def describe(db: Session, ws: int = 1) -> dict:
    st, cfg = _stored(db, ws), load_config(db, ws)
    fields = [{**{k: v for k, v in f.items() if k != "env"}, "default": default_of(f), "value": getattr(cfg, f["key"]), "modified": f["key"] in st, "group_label": GROUPS[f["group"]]} for f in FIELDS]
    rules = [{"key": r.__name__, **RULES[r.__name__], "enabled": r.__name__ not in cfg.disabled_rules} for r in ALL_RULES]
    return {"fields": fields, "rules": rules}

def update(db: Session, ws: int, values: dict, disabled_rules: list | None, actor: str) -> list[str]:
    """Validate then persist. value None resets a field to its default. Returns human-readable change list."""
    by = {f["key"]: f for f in FIELDS}; changes = []
    for k, v in values.items():
        if k not in by:
            raise ValueError(f"Unknown setting “{k}”.")
        f = by[k]
        if v is not None and (isinstance(v, bool) or not isinstance(v, int) or not f["min"] <= v <= f["max"]):
            raise ValueError(f"“{f['label']}” must be a whole number between {f['min']} and {f['max']}.")
    valid = {r.__name__ for r in ALL_RULES}
    if disabled_rules is not None and not set(disabled_rules) <= valid:
        raise ValueError("Unknown detection rule in list.")
    now = datetime.now(timezone.utc)
    def put(key, val, label):
        row = db.get(SettingRow, (ws, key))
        if val is None:
            if row: db.delete(row)
        elif row: row.value, row.updated_by, row.updated_at = {"v": val}, actor, now
        else: db.add(SettingRow(workspace_id=ws, key=key, value={"v": val}, updated_by=actor, updated_at=now))
        changes.append(label)
    cur = load_config(db, ws)
    for k, v in values.items():
        if v != getattr(cur, k) or (v is None and db.get(SettingRow, (ws, k))):
            put(k, v, f"{by[k]['label']}: {'reset to default' if v is None else v}")
    if disabled_rules is not None and set(disabled_rules) != set(cur.disabled_rules):
        put("disabled_rules", sorted(disabled_rules) or None, "Detection rules: " + (", ".join(sorted(disabled_rules)) + " turned off" if disabled_rules else "all on"))
    db.commit()
    return changes
