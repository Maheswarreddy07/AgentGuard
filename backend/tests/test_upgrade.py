import sqlite3
from fastapi.testclient import TestClient
from app.main import create_app

OLD_SCHEMA = """
create table traces (trace_id varchar(128) primary key, agent_name varchar(128) not null, created_at datetime, n_events integer, status varchar(16), max_severity varchar(16), categories json, headline varchar(500), category_severity json, updated_at datetime);
create table events (id integer primary key autoincrement, trace_id varchar(128) not null references traces(trace_id), event_id varchar(128) not null, step_index integer not null, payload json not null, unique(trace_id, event_id));
create table app_settings (key varchar(64) primary key, value json not null, updated_by varchar(254), updated_at datetime);
create table users (id integer primary key autoincrement, email varchar(254) not null unique, name varchar(120), password_hash varchar(300) not null, role varchar(16), is_active boolean, failed_attempts integer, locked_until datetime, created_at datetime, last_login_at datetime);
"""

def test_pre_workspace_database_is_upgraded_without_losing_anything(tmp_path):
    db = tmp_path / "old.db"; con = sqlite3.connect(db); con.executescript(OLD_SCHEMA)
    con.execute("insert into traces values ('legacy-1','support-agent','2026-01-01 10:00:00',2,'flagged','high','[\"tool_execution_failure\"]','boom','{}','2026-01-01 10:00:01')")
    ev = '{"trace_id":"legacy-1","run_id":"r","event_id":"e%d","agent_name":"support-agent","event_type":"%s","timestamp":"2026-01-01T10:00:0%d+00:00","step_index":%d,"metadata":{}}'
    con.execute("insert into events (trace_id,event_id,step_index,payload) values ('legacy-1','e0',0,?)", (ev % (0, "run_start", 0, 0),))
    con.execute("insert into events (trace_id,event_id,step_index,payload) values ('legacy-1','e1',1,?)", (ev % (1, "run_end", 1, 1),))
    con.execute("insert into app_settings values ('max_retries','{\"v\": 2}','admin','2026-01-01 10:00:00')")
    con.execute("insert into users (email,name,password_hash,role,is_active,failed_attempts,created_at) values ('a@x.io','A','h','admin',1,0,'2026-01-01 10:00:00')")
    con.commit(); con.close()
    c = TestClient(create_app(f"sqlite:///{db}", tmp_path, auth_required=False))
    t = c.get("/api/v1/traces/legacy-1").json()
    assert t["trace_id"] == "legacy-1" and len(t["events"]) == 2                       # data survived the primary-key change
    assert c.get("/api/v1/settings").json()["fields"][0]["value"] == 2                  # per-workspace setting carried over
    con = sqlite3.connect(db); assert con.execute("select workspace_id from users").fetchone()[0] == 1; assert con.execute("select count(*) from workspaces").fetchone()[0] == 1
