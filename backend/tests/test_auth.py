import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.auth import hash_password, verify_password
from app.db.models import SessionRow
from app.main import create_app
from tests.test_api import E

ROOT = Path(__file__).resolve().parents[2] / "benchmarks/scenarios"
PW = "correct-horse-battery"

@pytest.fixture
def app(tmp_path):
    shutil.copytree(ROOT / "v1", tmp_path / "v1")
    return create_app("sqlite:///:memory:", tmp_path, auth_required=True)

@pytest.fixture
def c(app): return TestClient(app)

def H(tok): return {"Authorization": f"Bearer {tok}"}
def setup_admin(c, email="admin@x.io"): return c.post("/api/v1/auth/setup", json={"email": email, "password": PW, "name": "Ada"}).json()["token"]
def make_user(c, admin, role, email=None):
    email = email or f"{role}@x.io"
    assert c.post("/api/v1/users", headers=H(admin), json={"email": email, "role": role, "password": PW}).status_code == 201
    return c.post("/api/v1/auth/login", json={"email": email, "password": PW}).json()["token"]

def test_password_hashing():
    h = hash_password("secret-password-1"); assert verify_password("secret-password-1", h) and not verify_password("nope", h) and "secret" not in h
    assert not verify_password("x", "garbage") and hash_password("secret-password-1") != h  # salted

def test_everything_requires_sign_in_except_health_and_status(c):
    assert c.get("/health").status_code == 200
    s = c.get("/api/v1/auth/status").json(); assert s["auth_required"] and s["setup_required"]
    for path in ("/api/v1/traces", "/api/v1/meta", "/api/v1/settings", "/api/v1/scenarios", "/api/v1/users"):
        r = c.get(path); assert r.status_code == 401 and r.json()["error"]["code"] == "http_error", path
    assert c.post("/api/v1/traces", json={"trace_id": "x", "events": []}).status_code == 401

def test_first_run_setup_once_with_strong_password(c):
    assert c.post("/api/v1/auth/setup", json={"email": "bad", "password": PW}).status_code == 422
    assert c.post("/api/v1/auth/setup", json={"email": "a@x.io", "password": "short"}).status_code == 422
    r = c.post("/api/v1/auth/setup", json={"email": "A@X.io", "password": PW}); assert r.status_code == 201 and r.json()["user"]["role"] == "admin" and r.json()["user"]["email"] == "a@x.io"
    assert "password" not in r.text and not c.get("/api/v1/auth/status").json()["setup_required"]
    assert c.post("/api/v1/auth/setup", json={"email": "b@x.io", "password": PW}).status_code == 409

def test_login_logout_me(c):
    setup_admin(c)
    bad = c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": "wrong-password"}); ghost = c.post("/api/v1/auth/login", json={"email": "nobody@x.io", "password": "wrong-password"})
    assert bad.status_code == ghost.status_code == 401 and bad.json() == ghost.json()  # no account enumeration
    tok = c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": PW}).json()["token"]
    assert c.get("/api/v1/auth/me", headers=H(tok)).json()["role"] == "admin"
    assert c.post("/api/v1/auth/logout", headers=H(tok)).status_code == 200
    assert c.get("/api/v1/auth/me", headers=H(tok)).status_code == 401

def test_lockout_after_repeated_failures(c, monkeypatch):
    monkeypatch.setenv("AUTH_MAX_FAILURES", "3"); setup_admin(c)
    for _ in range(3): assert c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": "wrong-password"}).status_code == 401
    assert c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": PW}).status_code == 429   # even the right password is refused while locked

def test_expired_and_forged_tokens_rejected(c, app):
    tok = setup_admin(c)
    assert c.get("/api/v1/traces", headers=H("forged-token")).status_code == 401
    with app.state.factory() as db:
        for s in db.scalars(select(SessionRow)): s.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    assert c.get("/api/v1/traces", headers=H(tok)).status_code == 401

def test_role_permissions(c):
    admin = setup_admin(c); viewer, member = make_user(c, admin, "viewer"), make_user(c, admin, "member")
    assert c.get("/api/v1/traces", headers=H(viewer)).status_code == 200
    for method, path in (("post", "/api/v1/benchmarks/run"), ("post", "/api/v1/demo/seed")):
        assert getattr(c, method)(path, headers=H(viewer), json={}).status_code == 403
        assert getattr(c, method)(path, headers=H(member), json={}).status_code in (200, 202)
    for path in ("/api/v1/users", "/api/v1/api-keys"):
        assert c.get(path, headers=H(member)).status_code == 403 and c.get(path, headers=H(admin)).status_code == 200
    assert c.put("/api/v1/settings", headers=H(member), json={"values": {}}).status_code == 403

def test_api_keys_can_only_ingest_and_can_be_revoked(c):
    admin = setup_admin(c)
    k = c.post("/api/v1/api-keys", headers=H(admin), json={"name": "prod agent"}).json(); key = k["key"]
    assert key.startswith("ag_") and key not in c.get("/api/v1/api-keys", headers=H(admin)).text   # shown once, never listed
    assert c.post("/api/v1/traces", headers=H(key), json={"trace_id": "t1", "events": [E(0, "run_start")]}).status_code == 201
    assert c.get("/api/v1/traces", headers=H(key)).status_code == 403 and c.get("/api/v1/users", headers=H(key)).status_code == 403
    assert c.get("/api/v1/api-keys", headers=H(admin)).json()["items"][0]["last_used_at"]
    c.delete(f"/api/v1/api-keys/{k['id']}", headers=H(admin))
    assert c.post("/api/v1/traces", headers=H(key), json={"trace_id": "t2", "events": [E(0, "run_start")]}).status_code == 401

def test_cannot_remove_last_admin_and_disabled_user_is_signed_out(c):
    admin = setup_admin(c); me = c.get("/api/v1/auth/me", headers=H(admin)).json()["id"]
    assert c.patch(f"/api/v1/users/{me}", headers=H(admin), json={"role": "viewer"}).status_code == 409
    assert c.patch(f"/api/v1/users/{me}", headers=H(admin), json={"is_active": False}).status_code == 409
    v = make_user(c, admin, "viewer"); vid = [u for u in c.get("/api/v1/users", headers=H(admin)).json()["items"] if u["role"] == "viewer"][0]["id"]
    c.patch(f"/api/v1/users/{vid}", headers=H(admin), json={"is_active": False})
    assert c.get("/api/v1/traces", headers=H(v)).status_code == 401
    assert c.post("/api/v1/auth/login", json={"email": "viewer@x.io", "password": PW}).status_code == 401

def test_change_password_signs_out_other_sessions(c):
    setup_admin(c); a = c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": PW}).json()["token"]; b = c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": PW}).json()["token"]
    assert c.post("/api/v1/auth/change-password", headers=H(a), json={"current_password": "nope-nope-nope", "new_password": "another-long-pass"}).status_code == 403
    assert c.post("/api/v1/auth/change-password", headers=H(a), json={"current_password": PW, "new_password": "short"}).status_code == 422
    assert c.post("/api/v1/auth/change-password", headers=H(a), json={"current_password": PW, "new_password": "another-long-pass"}).status_code == 200
    assert c.get("/api/v1/auth/me", headers=H(a)).status_code == 200 and c.get("/api/v1/auth/me", headers=H(b)).status_code == 401
    assert c.post("/api/v1/auth/login", json={"email": "admin@x.io", "password": "another-long-pass"}).status_code == 200

def test_history_records_activity_and_hides_security_from_non_admins(c):
    admin = setup_admin(c); viewer = make_user(c, admin, "viewer")
    c.post("/api/v1/demo/seed", headers=H(admin)); run = c.post("/api/v1/benchmarks/run", headers=H(admin), json={"scenario_ids": ["success-000"]}).json()["run_id"]
    c.post("/api/v1/traces/success-000/recover", headers=H(admin), json={})
    a = c.get("/api/v1/history/activity?limit=100", headers=H(admin)).json(); acts = {i["action"] for i in a["items"]}
    assert {"setup_completed", "login", "demo_seeded", "benchmark_started", "recovery_simulated", "user_created"} <= acts
    v = c.get("/api/v1/history/activity?limit=100", headers=H(viewer)).json(); vacts = {i["action"] for i in v["items"]}
    assert "benchmark_started" in vacts and not (vacts & {"login", "user_created", "login_failed"}) and "login" not in v["actions"]
    h = c.get("/api/v1/history/benchmarks", headers=H(viewer)).json()["items"]; assert h and h[0]["run_id"] == run and h[0]["config"]["max_retries"] == 3

def test_settings_validation_effects_and_reset(c):
    admin = setup_admin(c); c.post("/api/v1/demo/seed", headers=H(admin))
    s = c.get("/api/v1/settings", headers=H(admin)).json()
    assert {f["key"] for f in s["fields"]} >= {"max_retries", "retention_days"} and all(f["help"] and f["default"] is not None for f in s["fields"]) and len(s["rules"]) == 15
    assert "YOUR_API_KEY" in s["system"]["connect"]["snippet"] and s["system"]["connect"]["base_url"].startswith("http")
    for bad in ({"max_retries": 0}, {"max_retries": "3"}, {"nope": 1}, {"retention_days": 99999}):
        assert c.put("/api/v1/settings", headers=H(admin), json={"values": bad}).status_code == 422
    assert c.put("/api/v1/settings", headers=H(admin), json={"values": {}, "disabled_rules": ["bogus"]}).status_code == 422
    before = c.get("/api/v1/traces/facets", headers=H(admin)).json()["category"].get("tool_execution_failure", 0); assert before > 0
    r = c.put("/api/v1/settings", headers=H(admin), json={"values": {"max_retries": 1}, "disabled_rules": ["tool_failure"]}).json()
    assert r["changes"] and [f for f in r["fields"] if f["key"] == "max_retries"][0]["value"] == 1
    assert c.get("/api/v1/traces/facets", headers=H(admin)).json()["category"].get("tool_execution_failure", 0) == 0     # rule off -> summaries refreshed
    c.put("/api/v1/settings", headers=H(admin), json={"values": {"max_retries": None}, "disabled_rules": []})
    assert c.get("/api/v1/traces/facets", headers=H(admin)).json()["category"]["tool_execution_failure"] == before
    assert [f for f in c.get("/api/v1/settings", headers=H(admin)).json()["fields"] if f["key"] == "max_retries"][0]["modified"] is False

def test_retry_limit_setting_changes_recovery(c):
    admin = setup_admin(c)
    evs = [E(0, "run_start"), E(1, "tool_call", tool_name="x", metadata={"read_only": True}), E(2, "tool_result", tool_name="x", status="error", error_type="timeout"), E(3, "run_end")]
    c.post("/api/v1/traces", headers=H(admin), json={"trace_id": "t1", "events": evs})
    assert c.post("/api/v1/traces/t1/recover", headers=H(admin), json={"sim": {"transient_fail_count": 2}}).json()["outcome"]["recovered"] is True
    c.put("/api/v1/settings", headers=H(admin), json={"values": {"max_retries": 2}})
    assert c.post("/api/v1/traces/t1/recover", headers=H(admin), json={"sim": {"transient_fail_count": 2}}).json()["outcome"]["recovered"] is False

def test_cleanup_endpoint_and_template_and_previews(c):
    admin = setup_admin(c); c.post("/api/v1/demo/seed", headers=H(admin))
    assert c.post("/api/v1/settings/cleanup", headers=H(admin)).json()["deleted_traces"] == 0   # retention off
    t = c.get("/api/v1/traces?limit=1", headers=H(admin)).json()["items"][0]; assert t["preview"] and set(t["preview"][0]) == {"t", "s"}
    sc = c.get("/api/v1/scenarios", headers=H(admin)).json()["items"][0]; assert sc["preview"]
    tpl = c.get("/api/v1/scenarios/template", headers=H(admin)).json(); assert c.post("/api/v1/scenarios", headers=H(admin), json=tpl).status_code == 201

def test_bootstrap_admin_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ADMIN_EMAIL", "root@x.io"); monkeypatch.setenv("ADMIN_PASSWORD", PW)
    c = TestClient(create_app("sqlite:///:memory:", tmp_path, auth_required=True))
    assert not c.get("/api/v1/auth/status").json()["setup_required"] and c.post("/api/v1/auth/login", json={"email": "root@x.io", "password": PW}).status_code == 200
