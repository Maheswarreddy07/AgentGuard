"""Production hardening: per-key rate limits, idempotent writes, interrupted test runs."""
import pathlib, shutil
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_auth import H, make_user, setup_admin, PW


V1 = pathlib.Path(__file__).resolve().parents[2] / "benchmarks/scenarios/v1"

def authed(limit=None, tmp=None):
    d = None
    if tmp is not None: d = tmp / "sc"; shutil.copytree(V1, d / "v1")          # writes go to a throw-away folder, never into the repo
    c = TestClient(create_app("sqlite:///:memory:", d, auth_required=True, rate_limit=limit)); return c, setup_admin(c)


def test_each_credential_has_its_own_rate_allowance():
    c, admin = authed(limit=4)
    member = make_user(c, admin, "member")
    for _ in range(3): assert c.get("/api/v1/agents", headers=H(admin)).status_code == 200           # setup already used one request of the admin's allowance
    assert c.get("/api/v1/agents", headers=H(admin)).status_code == 429                                # the admin is out
    assert c.get("/api/v1/agents", headers=H(member)).status_code == 200                               # the member's own allowance is untouched
    assert c.get("/health").status_code == 200                                                         # health checks are never limited


def test_unauthenticated_requests_are_limited_by_address():
    c = TestClient(create_app("sqlite:///:memory:", rate_limit=3))
    codes = [c.get("/api/v1/auth/status").status_code for _ in range(5)]; assert codes[:3] == [200] * 3 and 429 in codes[3:]


def test_a_retried_write_with_the_same_key_is_not_done_twice():
    c, admin = authed(); h = {**H(admin), "Idempotency-Key": "create-rule-1"}
    body = {"name": "No big refunds", "category": "custom", "definition": {"scope": {"tools": ["refund"]}, "condition": {"type": "tool_denylist", "tools": ["refund"]}, "action": "BLOCK", "severity": "high", "message": "m"}}
    a = c.post("/api/v1/policies", headers=h, json=body); b = c.post("/api/v1/policies", headers=h, json=body)
    assert a.status_code in (200, 201), a.text
    assert b.status_code == a.status_code and b.json() == a.json() and b.headers.get("Idempotent-Replay") == "true"
    assert len([p for p in c.get("/api/v1/policies", headers=H(admin)).json()["items"] if p["name"] == "No big refunds"]) == 1


def test_a_key_cannot_be_reused_for_a_different_request(tmp_path):
    c, admin = authed(tmp=tmp_path); h = {**H(admin), "Idempotency-Key": "k1"}
    s1 = {"id": "idem-1", "category": "custom", "description": "[SYNTHETIC] one", "task": "t", "events": [{"event_id": "e0", "step_index": 0, "event_type": "run_start"}, {"event_id": "e1", "step_index": 1, "event_type": "run_end", "metadata": {"claimed_success": True}}], "labels": {"failure_categories": [], "earliest_detectable_step": None, "expected_action": "none"}}
    assert c.post("/api/v1/scenarios", headers=h, json=s1).status_code == 201
    r = c.post("/api/v1/scenarios", headers=h, json={**s1, "id": "idem-2"}); assert r.status_code == 422 and r.json()["error"]["code"] == "idempotency_key_reused"


def test_writes_without_a_key_behave_as_before(tmp_path):
    c, admin = authed(tmp=tmp_path); s1 = c.get("/api/v1/scenarios/template", headers=H(admin)).json(); s1["id"] = "plain-1"
    assert c.post("/api/v1/scenarios", headers=H(admin), json=s1).status_code == 201
    assert c.post("/api/v1/scenarios", headers=H(admin), json=s1).status_code == 409          # duplicates are still refused by the endpoint itself


def test_interrupted_runs_are_marked_failed_and_concurrent_runs_are_capped(tmp_path):
    from datetime import datetime, timedelta, timezone
    from app.db.models import BenchmarkRow
    d = tmp_path / "sc"; shutil.copytree(V1, d / "v1"); url = f"sqlite:///{tmp_path}/t.db"
    first = create_app(url, d)
    with first.state.factory() as s:
        s.add(BenchmarkRow(run_id="old", workspace_id=1, status="running", created_at=datetime.now(timezone.utc) - timedelta(minutes=30), params={})); s.commit()
    app = create_app(url, d); c = TestClient(app)                                                        # a restart
    with app.state.factory() as s:
        old = s.get(BenchmarkRow, "old"); assert old.status == "failed" and "Interrupted" in old.error
        for i in range(3): s.add(BenchmarkRow(run_id=f"live{i}", workspace_id=1, status="running", params={}))
        s.commit()
    assert c.post("/api/v1/benchmarks/run", json={"seed": 0}).status_code == 429                        # three real runs are already in progress
    with app.state.factory() as s:
        for i in range(3): s.get(BenchmarkRow, f"live{i}").status = "completed"
        s.commit()
    assert c.post("/api/v1/benchmarks/run", json={"seed": 0}).status_code == 202


def test_each_rule_reports_what_it_really_did(tmp_path):
    """Counts come from the recorded decisions: stopped, asked for approval, warned, or only watched."""
    from tests.test_runtime_api import H as HH  # noqa: F401
    c, admin = authed(tmp=tmp_path)
    r = c.post("/api/v1/policies", headers=H(admin), json={"name": "no-rm", "category": "custom", "definition": {"scope": {"tools": ["rm"]}, "condition": {"type": "tool_denylist", "tools": ["rm"]}, "action": "BLOCK", "severity": "high", "message": ""}}); assert r.status_code == 201, r.text
    key = c.post("/api/v1/api-keys", headers=H(admin), json={"name": "k"}).json()["key"]
    for mode in ("enforce", "enforce", "observe"):
        assert c.post("/api/v1/runtime/check", headers=H(key), json={"trace_id": "t-" + mode, "agent_name": "a", "tool_name": "rm", "arguments": {}, "mode": mode, "step_index": 1}).status_code == 200
    c.post("/api/v1/runtime/check", headers=H(key), json={"trace_id": "t-x", "agent_name": "a", "tool_name": "ls", "arguments": {}, "mode": "enforce", "step_index": 1})
    item = next(i for i in c.get("/api/v1/policies", headers=H(admin)).json()["items"] if i["name"] == "no-rm")
    assert item["matches"] == 3 and item["effects"]["blocked"] == 2 and item["effects"]["only_watched"] == 1 and item["effects"]["last_matched_at"]
    assert item["effects"]["approval_requested"] == 0 and item["effects"]["warned"] == 0


def test_api_answers_are_not_cached_and_oversized_bodies_are_refused():
    c, admin = authed()
    r = c.get("/api/v1/agents", headers=H(admin)); assert r.headers["cache-control"] == "no-store" and r.headers["x-content-type-options"] == "nosniff"
    big = c.post("/api/v1/traces", headers={**H(admin), "Content-Length": "6000001", "Content-Type": "application/json"}, content=b"{}")
    assert big.status_code == 413 and big.json()["error"]["code"] == "payload_too_large"


@pytest.mark.parametrize("pw", ["plain", "Maheswar2005@", "a:b/c#d%e?f", "p@ss@word@@", "üñí cödé", "  spaces  "])
def test_database_url_is_built_safely_for_any_password(monkeypatch, pw):
    """A password with @ : / # % must not be read as part of the host (this broke a real Docker Compose start-up)."""
    from sqlalchemy.engine import make_url
    from app.db.url import database_url
    for k in ("DATABASE_URL",): monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DB_HOST", "db"); monkeypatch.setenv("DB_USER", "agentguard"); monkeypatch.setenv("DB_PASSWORD", pw); monkeypatch.setenv("DB_NAME", "agentguard")
    u = make_url(database_url())
    assert u.host == "db" and u.password == pw and u.username == "agentguard" and u.database == "agentguard" and u.port == 5432


def test_database_url_prefers_an_explicit_url_and_falls_back_to_sqlite(monkeypatch):
    from app.db.url import database_url
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://x:y@h/d"); monkeypatch.setenv("DB_HOST", "ignored"); assert database_url() == "postgresql+psycopg://x:y@h/d"
    monkeypatch.delenv("DATABASE_URL"); monkeypatch.delenv("DB_HOST"); assert database_url().startswith("sqlite")
