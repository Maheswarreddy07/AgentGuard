import json, os, re, time, uuid
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import IntegrityError
from starlette.background import BackgroundTask
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin_routes, auth_routes, runtime_routes
from app.api.deps import Principal, audit, get_db, needs, require, require_agent
from app.auth import hash_password, sha
from app.catalog import ACTIONS, CATEGORIES, SAMPLE_RUNS, SEV_RANK, UI, meta
from app.db.models import AgentRow, ApprovalRow, BenchmarkRow, IdempotencyRow, EventRow, FindingRow, PolicyRow, TraceRow, UserRow, WorkspaceRow
from app.db.session import make_engine, make_session_factory
from app.detectors.rules import run_all
from app.evaluation.runner import build_events, run_benchmark
from app.evaluation.scenario import Scenario, load_scenarios
from app.localization.locate import localize
from app.recovery.policy import decide, execute
from app.schemas.events import Event, EventType
from app.services.demo import seed_demo
from app.services import regression, test_library
from app.services.diagnosis import diagnose, provider_from_env
from app.services.scope import SYNTHETIC, Scope, by_trace, scoped
from app.services.deletion import delete_agent, delete_synthetic, delete_traces
from app.services import database as dbinfo
from app.services.ingest import backfill_summaries, finding_id, get_trace, ingest, load_events
finding_id_of = finding_id
from app.services.retention import purge_older_than
from app.services.settings import load_config

MAX_EVENTS_PER_REQUEST = 500
DEFAULT_SCENARIOS = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"
Sev = Literal["info", "low", "medium", "high", "critical"]

class SampleRunIn(BaseModel):
    sample: str = Field(min_length=1, max_length=64)

class TraceCreate(BaseModel):
    trace_id: str = Field(min_length=1, max_length=128)
    events: list[Event] = Field(default_factory=list, max_length=MAX_EVENTS_PER_REQUEST)

class EventBatch(BaseModel):
    events: list[Event] = Field(min_length=1, max_length=MAX_EVENTS_PER_REQUEST)

class BenchRequest(BaseModel):
    scenario_ids: list[str] | None = None
    split: Literal["dev", "validation", "test"] | None = None
    seed: int = 0

class RecoverRequest(BaseModel):
    sim: dict = Field(default_factory=dict)  # simulated environment only; no live actions are executed

def _err(status: int, code: str, message: str, **extra):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, **extra}})

def enrich(f, ws: int, trace_id: str) -> dict:
    d = f.model_dump(mode="json"); c = CATEGORIES.get(d["category"], {})
    return {**d, "id": finding_id(ws, trace_id, f), "label": c.get("label", d["category"]), "why": c.get("why"), "fix": c.get("fix"), "proof": "rule" if d["deterministic"] else "heuristic", "source": "rule" if d["deterministic"] else "heuristic"}

def step_code(ev: dict) -> dict:
    """Tiny summary of one event for list previews: type + whether it looks bad."""
    md = ev.get("metadata") or {}
    bad = ev.get("status") == "error" or (ev.get("event_type") == "human_approval" and md.get("approved") is False) or (ev.get("event_type") == "policy_check" and md.get("effective") in ("BLOCK", "REQUIRE_APPROVAL"))
    return {"t": ev.get("event_type"), "s": "bad" if bad else "ok"}

BENCH_STALE_MINUTES, MAX_CONCURRENT_BENCHMARKS = 10, 3
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", "5000000"))

def create_app(database_url: str | None = None, scenario_dir: Path | None = None, llm=None, rate_limit: int | None = None, auth_required: bool | None = None) -> FastAPI:
    scen_dir = Path(scenario_dir or DEFAULT_SCENARIOS)
    app = FastAPI(title="AgentGuard", version="0.4.0")
    app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o],
                       allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])
    factory = make_session_factory(make_engine(database_url))
    llm_provider = llm if llm is not None else provider_from_env()
    st = app.state
    st.factory, st.llm_enabled, st.max_events, st.scen_dir = factory, llm_provider is not None, MAX_EVENTS_PER_REQUEST, scen_dir
    st.auth_required = auth_required if auth_required is not None else os.getenv("AUTH_REQUIRED", "1") == "1"
    st.rate_limit_override = rate_limit
    hits: dict[str, deque] = defaultdict(deque)
    with factory() as s:  # startup housekeeping
        st.cfg = load_config(s, 1)
        backfill_summaries(s)
        for w in s.scalars(select(WorkspaceRow)): purge_older_than(s, load_config(s, w.id).retention_days, w.id)
        em, pw = os.getenv("ADMIN_EMAIL"), os.getenv("ADMIN_PASSWORD")   # optional bootstrap for unattended installs
        if st.auth_required and em and pw and not s.scalar(select(func.count()).select_from(UserRow)):
            s.add(UserRow(workspace_id=1, email=em.strip().lower(), name="Admin", role="admin", password_hash=hash_password(pw))); s.commit()
    app.include_router(auth_routes.router); app.include_router(admin_routes.router); app.include_router(runtime_routes.router)

    # ---------- consistent errors ----------
    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        return _err(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return _err(422, "validation_error", "Request failed validation", details=[{"where": ".".join(str(x) for x in e["loc"]), "problem": e["msg"]} for e in exc.errors()][:10])

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, __: Exception):  # never leak stack traces
        return _err(500, "internal_error", "Internal server error")

    @app.middleware("http")
    async def safe_responses(request: Request, call_next):
        """Refuse oversized bodies before reading them, and keep API answers out of shared caches and browser history."""
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
            return _err(413, "payload_too_large", f"The request is larger than {MAX_BODY_BYTES // 1_000_000} MB. Send fewer events per request.")
        r = await call_next(request)
        r.headers.setdefault("X-Content-Type-Options", "nosniff"); r.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith("/api/"): r.headers.setdefault("Cache-Control", "no-store")
        return r

    @app.middleware("http")
    async def rate_limiter(request: Request, call_next):
        limit = st.rate_limit_override if st.rate_limit_override is not None else st.cfg.rate_limit_per_min
        if limit > 0 and request.url.path != "/health" and request.method != "OPTIONS":
            ip, now = (request.client.host if request.client else "?"), time.monotonic()
            tok = request.headers.get("authorization", "")[7:].strip() if request.headers.get("authorization", "").lower().startswith("bearer ") else ""
            # Every API key and login session gets its own allowance, so one busy agent cannot starve another. The address is a wider backstop
            # (and the only limit for people who are not signed in, such as login attempts).
            buckets = [("ip:" + ip, limit * 10 if tok else limit)] + ([("k:" + sha(tok)[:24], limit)] if tok else [])
            for name, cap in buckets:
                q = hits[name]
                while q and now - q[0] > 60:
                    q.popleft()
                if len(q) >= cap:
                    r = _err(429, "rate_limited", "Too many requests — slow down and try again in a minute."); r.headers["Retry-After"] = "60"; return r
            for name, _ in buckets:
                hits[name].append(now)
        return await call_next(request)

    @app.middleware("http")
    async def idempotent_writes(request: Request, call_next):
        """Send an Idempotency-Key header with a write and a retry of that write returns the first answer instead of doing it twice."""
        key, auth = request.headers.get("idempotency-key"), request.headers.get("authorization", "")
        if not key or request.method not in ("POST", "PUT", "PATCH", "DELETE") or not request.url.path.startswith("/api/v1/") or not auth:
            return await call_next(request)
        if len(key) > 120:
            return _err(422, "idempotency_key_invalid", "The Idempotency-Key header is too long (120 characters at most).")
        body = await request.body()
        scope, fp = sha(auth + "|" + key)[:64], sha(f"{request.method} {request.url.path}?{request.url.query} ".encode().decode() + body.decode("utf-8", "replace"))
        with factory() as s:
            s.query(IdempotencyRow).filter(IdempotencyRow.created_at < datetime.now(timezone.utc) - timedelta(hours=24)).delete()
            row = s.get(IdempotencyRow, scope)
            if row is not None:
                if row.fingerprint != fp:
                    return _err(422, "idempotency_key_reused", "That Idempotency-Key was already used for a different request.")
                if row.status_code is None:
                    return _err(409, "request_in_progress", "The first request with this Idempotency-Key is still running.")
                r = Response(content=row.body or "", status_code=row.status_code, media_type=row.content_type or "application/json"); r.headers["Idempotent-Replay"] = "true"; return r
            s.add(IdempotencyRow(scope=scope, fingerprint=fp)); 
            try: s.commit()
            except IntegrityError: s.rollback(); return _err(409, "request_in_progress", "The first request with this Idempotency-Key is still running.")
        resp = await call_next(request)
        chunks = [c async for c in resp.body_iterator]; data = b"".join(chunks)
        with factory() as s:
            row = s.get(IdempotencyRow, scope)
            if row is not None:
                if resp.status_code >= 500 or len(data) > 262144: s.delete(row)      # a server error or a huge answer is not remembered, so the retry can try again
                else: row.status_code, row.body, row.content_type = resp.status_code, data.decode("utf-8", "replace"), resp.media_type or resp.headers.get("content-type", "application/json").split(";")[0]
                s.commit()
        out = Response(content=data, status_code=resp.status_code, headers={k: v for k, v in resp.headers.items() if k.lower() not in ("content-length",)}, media_type=resp.media_type); return out

    def trace_or_404(db: Session, ws: int, trace_id: str) -> TraceRow:
        t = get_trace(db, ws, trace_id)
        if t is None:
            raise HTTPException(404, "trace not found")   # identical for 'does not exist' and 'belongs to another workspace'
        return t

    def brief(t: TraceRow) -> dict:
        return {"trace_id": t.trace_id, "agent_name": t.agent_name, "created_at": t.created_at, "n_events": t.n_events, "status": t.status, "max_severity": t.max_severity, "categories": t.categories or [],
                "headline": t.headline, "task": t.task, "environment": t.environment, "mode": t.mode, "outcome": t.outcome, "duration_ms": t.duration_ms, "tool_calls": t.tool_calls, "tokens": (t.tokens_in or 0) + (t.tokens_out or 0),
                "cost_usd": t.cost_usd, "risk_score": t.risk_score, "finding_count": t.finding_count, "recovery_attempts": t.recovery_attempts, "blocked_actions": t.blocked_actions}

    def detect(db: Session, ws: int, events):
        c = load_config(db, ws)
        return run_all(events, c.disabled_rules, c.retry_loop_threshold, c.duplicate_call_threshold), c

    # ---------- open endpoints ----------
    @app.get("/health")
    def health(db: Session = Depends(get_db)):
        db.execute(select(1))
        return {"status": "ok", "database": "ok", "version": app.version}

    @app.get("/api/v1/meta")
    def get_meta(p: Principal = Depends(require("viewer"))): return meta(p.role)

    # ---------- ingestion ----------
    @app.post("/api/v1/traces", status_code=201)
    def create_trace(body: TraceCreate, p: Principal = Depends(require_agent), db: Session = Depends(get_db)):
        try:
            return {"trace_id": body.trace_id, **ingest(db, p.workspace_id, body.trace_id, body.events)}
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/v1/traces/{trace_id}/events", status_code=202)
    def add_events(trace_id: str, body: EventBatch, p: Principal = Depends(require_agent), db: Session = Depends(get_db)):
        try:
            return ingest(db, p.workspace_id, trace_id, body.events)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/v1/demo/seed")
    def demo_seed(p: Principal = Depends(needs("load_demo")), db: Session = Depends(get_db)):
        n = seed_demo(db, p.workspace_id, scen_dir); audit(db, p, "demo_seeded", None, {"new_traces": n})
        return {"seeded": n, "note": "Synthetic demo traces."}

    @app.post("/api/v1/agents/{name}/sample-run", status_code=201)
    def sample_run(name: str, body: SampleRunIn, p: Principal = Depends(needs("run_sample_agent")), db: Session = Depends(get_db)):
        """Plays one SIMULATED run for this agent through the real ingestion, detectors and risk engine (so a person can see AgentGuard react without writing code)."""
        spec = next((x for x in SAMPLE_RUNS if x["key"] == body.sample), None)
        if spec is None: raise HTTPException(404, "Unknown sample.")
        want = [spec["failure"]] if spec["failure"] else []
        every = load_scenarios(scen_dir)     # the cleanest match first: exactly this problem, else any run that contains it
        pool = sorted((x for x in every if x.labels.failure_categories == want), key=lambda x: (x.category == "adversarial", len(x.events), x.id)) or \
               sorted((x for x in every if spec["failure"] in x.labels.failure_categories), key=lambda x: (len(x.labels.failure_categories), x.category == "adversarial", len(x.events), x.id))
        if not pool: raise HTTPException(404, "No matching sample is available.")
        tid = f"sample-{spec['key']}-{uuid.uuid4().hex[:6]}"
        evs = [e.model_copy(update={"trace_id": tid, "run_id": tid, "agent_name": name.strip(), "metadata": {**e.metadata, "sample_run": True}}) for e in build_events(pool[0])]
        ingest(db, p.workspace_id, tid, evs); audit(db, p, "sample_run", tid, {"agent": name, "sample": spec["key"]})
        t = get_trace(db, p.workspace_id, tid)
        return {"trace_id": tid, "agent": name.strip(), "sample": spec["key"], "findings": t.finding_count, "headline": t.headline, "max_severity": t.max_severity, "categories": t.categories or [], "simulated": True}

    # ---------- deleting ----------
    @app.delete("/api/v1/traces/{trace_id}")
    def remove_trace(trace_id: str, p: Principal = Depends(needs("delete_data")), db: Session = Depends(get_db)):
        if get_trace(db, p.workspace_id, trace_id) is None: raise HTTPException(404, "Run not found.")
        delete_traces(db, p.workspace_id, [trace_id]); db.commit(); audit(db, p, "run_deleted", trace_id)
        return {"deleted": 1}

    @app.delete("/api/v1/agents/{name}")
    def remove_agent(name: str, with_runs: bool = False, p: Principal = Depends(needs("delete_data")), db: Session = Depends(get_db)):
        try: found, runs = delete_agent(db, p.workspace_id, name, with_runs)
        except ValueError as exc: raise HTTPException(409, f"This agent still has {exc}. Delete them together or remove the runs first.")
        if not found: raise HTTPException(404, "Agent not found.")
        db.commit(); audit(db, p, "agent_deleted", name, {"runs_deleted": runs})
        return {"deleted": 1, "runs_deleted": runs}

    @app.delete("/api/v1/scenarios/{scenario_id}")
    def remove_scenario(scenario_id: str, p: Principal = Depends(needs("delete_scenario")), db: Session = Depends(get_db)):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", scenario_id): raise HTTPException(404, "Scenario not found.")
        f = scen_dir / "custom" / str(p.workspace_id) / f"{scenario_id}.json"
        if not f.is_file():
            if any(s.id == scenario_id for s in load_scenarios(scen_dir)): raise HTTPException(409, "Built-in practice situations cannot be deleted.")
            raise HTTPException(404, "Scenario not found.")
        f.unlink(); audit(db, p, "scenario_deleted", scenario_id)
        return {"deleted": 1}

    @app.delete("/api/v1/demo-data")
    def remove_demo_data(p: Principal = Depends(needs("delete_data")), db: Session = Depends(get_db)):
        n, agents = delete_synthetic(db, p.workspace_id); db.commit(); audit(db, p, "demo_data_removed", None, {"runs_deleted": n, "agents_deleted": agents})
        return {"deleted": n, "agents_deleted": agents}

    # ---------- database ----------
    @app.get("/api/v1/admin/database")
    def database_status(p: Principal = Depends(needs("view_database")), db: Session = Depends(get_db)): return dbinfo.info(db, p.workspace_id)

    @app.get("/api/v1/admin/database/backup")
    def database_backup(p: Principal = Depends(needs("view_database")), db: Session = Depends(get_db)):
        url = db.get_bind().url
        if db.get_bind().dialect.name != "sqlite" or not url.database or url.database == ":memory:": raise HTTPException(501, "Automatic backup is only available for SQLite. For PostgreSQL use pg_dump (see docs/DEPLOYMENT.md).")
        path = dbinfo.sqlite_backup(db); audit(db, p, "database_backup")
        return FileResponse(path, media_type="application/octet-stream", filename=f"agentguard-backup-{time.strftime('%Y%m%d-%H%M%S')}.db", background=BackgroundTask(os.remove, path))

    # ---------- exploring traces ----------
    @app.get("/api/v1/traces")
    def list_traces(agent: str | None = None, status: Literal["clean", "flagged"] | None = None, severity: Sev | None = None, outcome: str | None = None, environment: str | None = None,
                    category: str | None = None, q: str | None = Query(None, max_length=100), date_from: date | None = None, date_to: date | None = None,
                    sort: Literal["newest", "severity", "events", "risk"] = "newest", limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), data: Scope = "production",
                    p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        rows = list(db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id), data)))
        ql = (q or "").lower()
        rows = [r for r in rows if (not agent or r.agent_name == agent) and (not status or r.status == status) and (not severity or r.max_severity == severity) and (not outcome or r.outcome == outcome)
                and (not environment or r.environment == environment) and (not category or category in (r.categories or [])) and (not q or ql in r.trace_id.lower() or ql in (r.task or "").lower() or ql in r.agent_name.lower())
                and (not date_from or r.created_at.date() >= date_from) and (not date_to or r.created_at.date() <= date_to)]
        key = {"newest": lambda r: r.created_at, "severity": lambda r: (SEV_RANK.get(r.max_severity or "", 0), r.created_at), "events": lambda r: r.n_events or 0, "risk": lambda r: r.risk_score or 0}[sort]
        rows.sort(key=key, reverse=True)
        page = rows[offset:offset + limit]; prev = defaultdict(list)
        if page:
            for tid, payload in db.execute(select(EventRow.trace_id, EventRow.payload).where(EventRow.workspace_id == p.workspace_id, EventRow.trace_id.in_([r.trace_id for r in page])).order_by(EventRow.step_index)):
                prev[tid].append(step_code(payload))
        return {"total": len(rows), "limit": limit, "offset": offset, "items": [{**brief(r), "preview": prev[r.trace_id]} for r in page]}

    @app.get("/api/v1/traces/facets")
    def facets(data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        rows = list(db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id), data))); cat, sev, ag, env, out = (defaultdict(int) for _ in range(5))
        for r in rows:
            ag[r.agent_name] += 1; env[r.environment or "unknown"] += 1; out[r.outcome or "unknown"] += 1
            if r.max_severity: sev[r.max_severity] += 1
            for c in r.categories or []: cat[c] += 1
        return {"total": len(rows), "flagged": sum(r.status == "flagged" for r in rows), "clean": sum(r.status == "clean" for r in rows), "severity": dict(sev), "category": dict(cat), "agent": dict(ag), "environment": dict(env), "outcome": dict(out)}

    @app.get("/api/v1/traces/compare")
    def compare_traces(a: str, b: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        """Side-by-side comparison of two runs: where their step sequences diverge and which findings differ."""
        ta, tb = trace_or_404(db, p.workspace_id, a), trace_or_404(db, p.workspace_id, b)
        seqs = []
        for t in (ta, tb):
            evs = sorted(load_events(db, p.workspace_id, t.trace_id), key=lambda e: e.step_index)
            seqs.append([{"step": e.step_index, "type": e.event_type.value, "tool": e.tool_name, "status": e.status.value} for e in evs])
        div = next((i for i, (x, y) in enumerate(zip(seqs[0], seqs[1])) if (x["type"], x["tool"], x["status"]) != (y["type"], y["tool"], y["status"])), None)
        if div is None and len(seqs[0]) != len(seqs[1]): div = min(len(seqs[0]), len(seqs[1]))
        ca, cb = set(ta.categories or []), set(tb.categories or [])
        return {"a": {**brief(ta), "steps": seqs[0]}, "b": {**brief(tb), "steps": seqs[1]}, "first_divergence_step": div, "findings": {"only_a": sorted(ca - cb), "only_b": sorted(cb - ca), "both": sorted(ca & cb)},
                "same_outcome": ta.outcome == tb.outcome}

    @app.get("/api/v1/traces/{trace_id}")
    def get_trace_detail(trace_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        t = trace_or_404(db, p.workspace_id, trace_id)
        return {**brief(t), "events": load_events(db, p.workspace_id, trace_id)}

    @app.get("/api/v1/traces/{trace_id}/export")
    def export_trace(trace_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        """A portable copy of the run (already redacted) that can be re-imported with POST /traces."""
        t = trace_or_404(db, p.workspace_id, trace_id)
        return {"format": "agentguard-trace/1", "trace": brief(t), "events": [e.model_dump(mode="json") for e in load_events(db, p.workspace_id, trace_id)]}

    def build_analysis(db: Session, ws: int, trace_id: str):
        trace_or_404(db, ws, trace_id)
        events = load_events(db, ws, trace_id); findings, cfg = detect(db, ws, events)
        loc = localize(events, findings); top = max(findings, key=lambda f: SEV_RANK[f.severity.value], default=None)
        return events, findings, cfg, {"trace_id": trace_id, "findings": [enrich(f, ws, trace_id) for f in findings], "localization": loc, "ai_diagnosis": None,
                                       "summary": {"status": "flagged" if findings else "clean", "headline": top.explanation if top else "No issues detected by the rules.",
                                                   "max_severity": top.severity.value if top else None, "n_findings": len(findings), "n_events": len(events)}}

    @app.get("/api/v1/findings/{finding_id}")
    def finding_detail(finding_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        """One problem in full: what it is, why it matters, the exact events that prove it, and where it started."""
        row = db.get(FindingRow, finding_id)
        if row is None or row.workspace_id != p.workspace_id:
            raise HTTPException(404, "finding not found")
        ws = p.workspace_id; t = trace_or_404(db, ws, row.trace_id); events = sorted(load_events(db, ws, row.trace_id), key=lambda e: e.step_index)
        findings, _ = detect(db, ws, events); live = next((f for f in findings if finding_id_of(ws, row.trace_id, f) == finding_id), None)
        ids = live.evidence_event_ids if live else ([row.event_id] if row.event_id else [])
        steps = {e.step_index for e in events if e.event_id in set(ids)}
        c = CATEGORIES.get(row.category, {})
        return {"id": row.id, "trace_id": row.trace_id, "category": row.category, "label": c.get("label", row.category), "why": c.get("why"), "fix": c.get("fix"), "severity": row.severity, "confidence": row.confidence,
                "source": row.source, "rule": row.rule, "description": row.description, "evidence": row.evidence, "suggested_action": row.suggested_action, "detected_at": row.detected_at, "evidence_event_ids": ids,
                "run": brief(t), "localization": localize(events, [live]) if live else None,
                "evidence_events": [e.model_dump(mode="json") for e in events if e.event_id in set(ids)],
                "context_events": [e.model_dump(mode="json") for e in events if any(abs(e.step_index - s_) <= 1 for s_ in steps)]}

    @app.get("/api/v1/traces/{trace_id}/analysis")
    def analysis(trace_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        return build_analysis(db, p.workspace_id, trace_id)[3]

    @app.post("/api/v1/traces/{trace_id}/analyze")
    def analyze(trace_id: str, p: Principal = Depends(needs("ask_ai_diagnosis")), db: Session = Depends(get_db)):
        events, findings, _, out = build_analysis(db, p.workspace_id, trace_id)
        out["ai_diagnosis"] = diagnose(llm_provider, events, findings)
        audit(db, p, "ai_diagnosis_requested", trace_id, {"status": out["ai_diagnosis"]["status"]})
        return out

    @app.get("/api/v1/traces/{trace_id}/recovery-plan")
    def recovery_plan(trace_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        events, findings, cfg, _ = build_analysis(db, p.workspace_id, trace_id)
        d = decide(events, findings, cfg.max_retries)
        return {"action": d.action, "action_label": ACTIONS[d.action]["label"], "icon": ACTIONS[d.action]["icon"], "plain": ACTIONS[d.action]["plain"], "reason": d.reason,
                "max_attempts": d.max_attempts, "executes_anything": False, "safety": "Consequential actions are never retried automatically; they always go to a human."}

    @app.post("/api/v1/traces/{trace_id}/recover")
    def recover(trace_id: str, body: RecoverRequest, p: Principal = Depends(needs("run_recovery")), db: Session = Depends(get_db)):
        events, findings, cfg, _ = build_analysis(db, p.workspace_id, trace_id)
        dec = decide(events, findings, cfg.max_retries); out = execute(dec, body.sim, cfg.max_retries); last = max(events, key=lambda e: e.step_index)
        rec = Event(trace_id=trace_id, run_id=last.run_id, event_id=f"recovery-{uuid.uuid4().hex[:8]}", agent_name=last.agent_name, event_type=EventType.RECOVERY_ATTEMPT,
                    timestamp=datetime.now(timezone.utc), step_index=last.step_index + 1, metadata={"simulated": True, "action": dec.action, "recovered": out.recovered, "terminal": out.terminal})
        ingest(db, p.workspace_id, trace_id, [rec])
        audit(db, p, "recovery_simulated", trace_id, {"action": dec.action, "label": ACTIONS[dec.action]["label"], "outcome": out.terminal, "recovered": out.recovered, "attempts": out.attempts})
        return {"simulated": True, "decision": dec, "action_label": ACTIONS[dec.action]["label"], "outcome": out, "findings_before": len(findings),
                "note": "Simulation only. No live tool was executed; consequential actions always escalate."}

    # ---------- metrics ----------
    @app.get("/api/v1/metrics/overview")
    def overview(agent: str | None = None, environment: str | None = None, severity: Sev | None = None, category: str | None = None, outcome: str | None = None,
                 date_from: date | None = None, date_to: date | None = None, data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        ws = p.workspace_id; rows = list(db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == ws), data)))
        rows = [r for r in rows if (not agent or r.agent_name == agent) and (not environment or r.environment == environment) and (not severity or r.max_severity == severity) and (not outcome or r.outcome == outcome)
                and (not category or category in (r.categories or [])) and (not date_from or r.created_at.date() >= date_from) and (not date_to or r.created_at.date() <= date_to)]
        by_cat, by_sev = defaultdict(int), defaultdict(int); cat_sev: dict = {}
        for r in rows:
            if r.max_severity: by_sev[r.max_severity] += 1
            for c in r.categories or []:
                by_cat[c] += 1
                sv = (r.category_severity or {}).get(c)
                if sv and SEV_RANK[sv] > SEV_RANK.get(cat_sev.get(c, ""), 0): cat_sev[c] = sv
        flagged = sum(r.status == "flagged" for r in rows); n = len(rows); done = [r for r in rows if r.duration_ms is not None]
        inc = sorted([r for r in rows if r.max_severity in ("high", "critical")], key=lambda r: (SEV_RANK[r.max_severity], r.updated_at or r.created_at), reverse=True)[:6]
        last = db.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "completed", BenchmarkRow.workspace_id == ws).order_by(BenchmarkRow.created_at.desc())).first()
        bm = (last.result or {}).get("metrics") if last else None
        pq = select(func.count()).select_from(ApprovalRow).where(ApprovalRow.workspace_id == ws, ApprovalRow.status == "pending"); pc = by_trace(ApprovalRow.trace_id, ws, data)
        pending = db.scalar(pq if pc is None else pq.where(pc))
        crit = sum(1 for r in rows if (r.category_severity or {}) and "critical" in (r.category_severity or {}).values())
        known = [a for a in db.scalars(select(AgentRow).where(AgentRow.workspace_id == ws)) if (data == "all" or (a.origin in SYNTHETIC) == (data == "synthetic"))]
        agents = {"registered": len(known), "connected": len({r.agent_name for r in rows} & {a.name for a in known})}
        serious = sum(1 for r in rows if r.max_severity in ("high", "critical")); rules_on = db.scalar(select(func.count()).select_from(PolicyRow).where(PolicyRow.workspace_id == ws, PolicyRow.enabled == True)) or 0   # noqa: E712
        suggestions = []                    # advice that follows from what is actually recorded; wording lives in the UI text, keyed by `key`
        if data == "production":
            if not agents["registered"]: suggestions.append({"key": "connect_first_agent", "path": "/integrations"})
            elif not agents["connected"]: suggestions.append({"key": "send_first_task", "path": "/integrations"})
            if pending: suggestions.append({"key": "review_approvals", "n": pending, "path": "/approvals"})
            if serious: suggestions.append({"key": "review_problems", "n": serious, "path": "/problems"})
            if agents["connected"] and not rules_on: suggestions.append({"key": "create_safety_rule", "path": "/policies"})
            if agents["registered"] and last is None: suggestions.append({"key": "run_reliability_test", "path": "/bench"})
            if agents["connected"] and not suggestions: suggestions.append({"key": "all_good", "path": "/traces"})
        return {"data": data, "agents": agents, "suggestions": suggestions, "live": {"total_runs": n, "runs_with_findings": flagged, "clean_runs": n - flagged, "failure_rate": (flagged / n) if n else None, "successful_runs": sum(r.outcome == "succeeded" for r in rows), "failed_runs": sum(r.outcome == "failed" for r in rows),
                         "blocked_runs": sum(r.outcome == "blocked" for r in rows), "running_runs": sum(r.outcome == "running" for r in rows), "risky_runs": sum((r.risk_score or 0) >= st.cfg.risk_alert_threshold for r in rows), "critical_runs": crit,
                         "blocked_actions": sum(r.blocked_actions for r in rows), "pending_approvals": pending, "recovery_attempts": sum(r.recovery_attempts for r in rows),
                         "avg_duration_ms": (sum(r.duration_ms for r in done) / len(done)) if done else None, "avg_risk": (sum(r.risk_score for r in rows) / n) if n else None, "total_cost_usd": round(sum(r.cost_usd for r in rows), 4),
                         "by_category": dict(by_cat), "category_stats": {c: {"count": by_cat[c], "max_severity": cat_sev.get(c)} for c in by_cat}, "by_severity": dict(by_sev), "recent_incidents": [brief(r) for r in inc]},
                "benchmark": ({"source": "synthetic", "run_id": last.run_id, "at": last.finished_at, "n_scenarios": bm["n_scenarios"], "detection": bm["detection"], "recovery": bm["recovery"], "outcomes": bm["outcomes"], "latency_ms": bm["latency_ms"]} if bm else None)}

    @app.get("/api/v1/metrics/trends")
    def trends(data: Scope = "production", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        days: dict[str, dict] = {}
        for t in db.scalars(scoped(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id), data)):
            k = t.created_at.date().isoformat(); d = days.setdefault(k, {"date": k, "runs": 0, "with_findings": 0, "blocked_actions": 0, "recoveries": 0})
            d["runs"] += 1; d["with_findings"] += t.status == "flagged"; d["blocked_actions"] += t.blocked_actions; d["recoveries"] += t.recovery_attempts
        return {"items": [days[k] for k in sorted(days)]}

    # ---------- benchmarks ----------
    def _run_bench(run_id: str, ws: int, req: BenchRequest):
        with factory() as s:
            row = s.get(BenchmarkRow, run_id)
            try:
                scs = load_scenarios(scen_dir, set(req.scenario_ids) if req.scenario_ids else None, ws, req.split)
                if not scs:
                    raise ValueError("no scenarios matched")
                row.result = json.loads(json.dumps(run_benchmark(scs, req.seed, load_config(s, ws), app.version))); row.status = "completed"
            except Exception as exc:  # recorded without stack trace
                row.status, row.error = "failed", str(exc)[:300]
            row.finished_at = datetime.now(timezone.utc); s.commit()

    def fail_interrupted_runs():
        """A run that has been 'running' longer than any real run takes was cut off (server restart or crash): say so instead of showing it as running forever."""
        with factory() as s:
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=BENCH_STALE_MINUTES)
            for r in s.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "running", BenchmarkRow.created_at < cutoff)):
                r.status, r.error, r.finished_at = "failed", "Interrupted: the server restarted or stopped before this run finished.", datetime.now(timezone.utc)
            s.commit()
    fail_interrupted_runs()

    @app.post("/api/v1/benchmarks/run", status_code=202)
    def run_bench(req: BenchRequest, bg: BackgroundTasks, p: Principal = Depends(needs("run_benchmark")), db: Session = Depends(get_db)):
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=BENCH_STALE_MINUTES)
        live = db.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "running", BenchmarkRow.created_at >= cutoff)).all()
        if len(live) >= MAX_CONCURRENT_BENCHMARKS:      # runs happen inside this server process: cap them so they cannot starve live traffic
            raise HTTPException(429, "Too many test runs are in progress. Wait for one to finish and try again.")
        run_id = uuid.uuid4().hex[:12]
        db.add(BenchmarkRow(run_id=run_id, workspace_id=p.workspace_id, status="running", params={**req.model_dump(), "started_by": p.email})); db.commit()
        audit(db, p, "benchmark_started", run_id, {"scenarios": len(req.scenario_ids) if req.scenario_ids else "all", "split": req.split or "all"})
        bg.add_task(_run_bench, run_id, p.workspace_id, req)  # status flips to completed only after the run really finishes
        return {"run_id": run_id, "status": "running"}

    def _bench(db, ws, run_id):
        row = db.get(BenchmarkRow, run_id)
        if row is None or (row.workspace_id or 1) != ws:
            raise HTTPException(404, "benchmark run not found")
        return row

    @app.get("/api/v1/benchmarks")
    def list_bench(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        rows = db.scalars(select(BenchmarkRow).where(BenchmarkRow.workspace_id == p.workspace_id).order_by(BenchmarkRow.created_at.desc()).limit(50))
        return {"items": [{"run_id": r.run_id, "status": r.status, "created_at": r.created_at, "finished_at": r.finished_at, "params": r.params,
                           "n_scenarios": ((r.result or {}).get("metrics") or {}).get("n_scenarios"),
                           "headline": ({"safe_protected": r.result["metrics"]["outcomes"]["protected_safe_outcome"], "safe_baseline": r.result["metrics"]["outcomes"]["baseline_safe_outcome"]} if r.result else None)} for r in rows]}

    @app.get("/api/v1/benchmark-compare")
    def compare(a: str, b: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        ra, rb = _bench(db, p.workspace_id, a), _bench(db, p.workspace_id, b)
        if ra.status != "completed" or rb.status != "completed":
            raise HTTPException(409, "both runs must be completed")
        da, db_ = (ra.result.get("dataset") or {}), (rb.result.get("dataset") or {})
        if not da.get("scenario_set_hash") or da.get("scenario_set_hash") != db_.get("scenario_set_hash") or (ra.result.get("versions") or {}).get("detector") != (rb.result.get("versions") or {}).get("detector"):
            raise HTTPException(409, "These runs used different scenarios or a different detector version, so their results are not comparable. Run both on the same scenarios.")
        ma, mb = ra.result["metrics"], rb.result["metrics"]
        pick = {"precision": lambda m: m["detection"]["micro_precision"], "recall": lambda m: m["detection"]["micro_recall"], "false_positive_rate": lambda m: m["detection"]["false_positive_rate"],
                "localization": lambda m: m["localization"]["accuracy"], "task_success": lambda m: m["outcomes"]["protected_task_success"], "safe_outcome": lambda m: m["outcomes"]["protected_safe_outcome"],
                "recovery_success": lambda m: m["recovery"]["recovery_success_rate"], "latency": lambda m: m["latency_ms"]["mean_added"]}
        rows = []
        for k, fn in pick.items():
            va, vb = fn(ma), fn(mb); rows.append({"metric": k, "a": va, "b": vb, "delta": (vb - va) if va is not None and vb is not None else None})
        return {"a": a, "b": b, "rows": rows, "dataset": da, "config_a": ra.result.get("config"), "config_b": rb.result.get("config"), "same_scenarios": True}

    @app.get("/api/v1/benchmarks/{run_id}")
    def get_bench(run_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        r = _bench(db, p.workspace_id, run_id)
        return {"run_id": r.run_id, "status": r.status, "error": r.error, "params": r.params, "label": (r.result or {}).get("label"), "config": (r.result or {}).get("config"), "metrics": (r.result or {}).get("metrics")}

    @app.get("/api/v1/benchmarks/{run_id}/results")
    def bench_results(run_id: str, only: Literal["all", "mistakes"] = "all", p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        r = _bench(db, p.workspace_id, run_id)
        if r.status != "completed":
            raise HTTPException(409, f"run is {r.status}")
        res = r.result["results"]
        if only == "mistakes":
            res = [x for x in res if sorted(x["true"]) != sorted(x["pred"])]
        return {"run_id": run_id, "results": res}

    # ---------- scenarios ----------
    @app.get("/api/v1/scenarios")
    def scenarios(split: Literal["dev", "validation", "test"] | None = None, p: Principal = Depends(require("viewer"))):
        return {"items": [{"id": s.id, "category": s.category, "description": s.description, "labels": s.labels, "n_events": len(s.events), "split": s.split, "source": s.source, "preview": [step_code(e) for e in s.events]}
                          for s in load_scenarios(scen_dir, ws=p.workspace_id, split=split)]}

    @app.get("/api/v1/tests/library")
    def test_library_view(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        """The built-in scenarios grouped into plain-language tests, each with its real last result (null = never run)."""
        runs = db.scalars(select(BenchmarkRow).where(BenchmarkRow.workspace_id == p.workspace_id).order_by(BenchmarkRow.created_at.desc()).limit(50)).all()
        return {**test_library.build_library(load_scenarios(scen_dir, ws=p.workspace_id), runs, UI["tests"]), "kind": "synthetic"}

    @app.get("/api/v1/benchmarks/{run_id}/summary")
    def bench_summary(run_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        """Plain-language counts for one completed run, counted from its stored per-scenario records."""
        r = _bench(db, p.workspace_id, run_id)
        if r.status != "completed" or not r.result:
            raise HTTPException(409, f"run is {r.status}")
        by_id = {x.id: x for x in load_scenarios(scen_dir, ws=p.workspace_id, unique=False)}
        return {"run_id": run_id, **test_library.summarise(r.result, by_id), "kind": (r.result.get("dataset") or {}).get("kind", "synthetic")}

    @app.get("/api/v1/scenarios/template")
    def scenario_template(_: Principal = Depends(require("viewer"))):
        return {"id": "my-scenario-001", "category": "custom", "description": "[SYNTHETIC] describe what this tests", "task": "What the agent was asked to do",
                "events": [{"event_id": "e0", "step_index": 0, "event_type": "run_start"}, {"event_id": "e1", "step_index": 1, "event_type": "run_end", "metadata": {"claimed_success": True}}],
                "labels": {"failure_categories": [], "earliest_detectable_step": None, "expected_action": "none"}}

    @app.get("/api/v1/scenarios/{scenario_id}")
    def scenario(scenario_id: str, p: Principal = Depends(require("viewer"))):
        s = next((x for x in load_scenarios(scen_dir, ws=p.workspace_id) if x.id == scenario_id), None)
        if s is None:
            raise HTTPException(404, "scenario not found")
        return {**s.model_dump(), "events": [e.model_dump(mode="json") for e in build_events(s)]}

    def _regression_draft(db: Session, ws: int, trace_id: str):
        """Scrub a real run and see what the detectors make of the scrubbed copy. Returns (trace, scrubbed events, what the real run showed, what the copy shows)."""
        t = trace_or_404(db, ws, trace_id)
        if (t.origin or "production") != "production": raise HTTPException(409, "Only real runs can become regression tests.")
        payloads = [e.payload for e in db.scalars(select(EventRow).where(EventRow.workspace_id == ws, EventRow.trace_id == trace_id))]
        if not payloads: raise HTTPException(409, "This run has no recorded steps to build a test from.")
        events = regression.scrub_events(payloads)
        real = sorted({f.category for f in db.scalars(select(FindingRow).where(FindingRow.workspace_id == ws, FindingRow.trace_id == trace_id))})
        draft = Scenario(id=regression.safe_id(trace_id), category="production", description="", task="[removed]", events=events, labels={})
        found, _ = detect(db, ws, build_events(draft))
        return t, events, real, found

    @app.get("/api/v1/traces/{trace_id}/test-preview")
    def test_preview(trace_id: str, p: Principal = Depends(needs("add_scenario")), db: Session = Depends(get_db)):
        """What a regression test made from this run would contain. Nothing is saved: a person reviews this, then confirms."""
        t, events, real, found = _regression_draft(db, p.workspace_id, trace_id)
        kept = sorted({f.category.value for f in found})
        return {"id": regression.safe_id(trace_id), "agent": t.agent_name, "n_events": len(events), "events": events, "failure_categories": [c for c in real if c in kept],
                "not_preserved": [c for c in real if c not in kept],      # problems that depended on the removed text (for example hidden instructions) cannot be tested from the scrubbed copy
                "kept": ["event types and order", "tool names", "statuses and error types", "numbers and true/false values", "which values repeat"], "removed": ["every piece of text in tool inputs, outputs and messages"]}

    class RegressionRequest(BaseModel):
        confirm_reviewed: bool
        failure_categories: list[str]
        description: str = Field(default="", max_length=300)

    @app.post("/api/v1/traces/{trace_id}/to-test", status_code=201)
    def make_regression_test(trace_id: str, body: RegressionRequest, p: Principal = Depends(needs("add_scenario")), db: Session = Depends(get_db)):
        """Save a scrubbed copy of a real failure as a test in your own library. The person must say they reviewed what is kept."""
        if not body.confirm_reviewed: raise HTTPException(422, "Confirm that you reviewed the test preview before saving it.")
        bad = [c for c in body.failure_categories if c not in CATEGORIES]
        if bad: raise HTTPException(422, f"unknown problem type: {bad[0]}")
        t, events, real, found = _regression_draft(db, p.workspace_id, trace_id)
        cats = sorted(set(body.failure_categories)); evs = build_events(Scenario(id="x", category="production", description="", task="", events=events, labels={}))
        steps = {c: min((e.step_index for f in found if f.category.value == c for e in evs if e.event_id in f.evidence_event_ids), default=None) for c in cats}
        known = [v for v in steps.values() if v is not None]
        action = decide(evs, [f for f in found if f.category.value in cats]).action if cats else "none"
        sid = regression.safe_id(trace_id)
        sc = Scenario(id=sid, category="production", description=(body.description.strip() or f"A real failure from the agent “{t.agent_name}”, with all text removed."), task="[removed]", events=events,
                      labels={"failure_categories": cats, "earliest_detectable_step": min(known) if known else None, "expected_action": action, "category_steps": {c: v for c, v in steps.items() if v is not None}})
        if any(x.id == sid for x in load_scenarios(scen_dir, ws=p.workspace_id)): raise HTTPException(409, "A test was already made from this run.")
        d = scen_dir / "custom" / str(p.workspace_id); d.mkdir(parents=True, exist_ok=True); (d / f"{sid}.json").write_text(sc.model_dump_json(indent=1))
        audit(db, p, "regression_test_created", sid, {"trace_id": trace_id, "categories": cats, "events": len(events)})
        return {"id": sid, "failure_categories": cats, "expected_action": action}

    @app.post("/api/v1/scenarios", status_code=201)
    def add_scenario(sc: Scenario, p: Principal = Depends(needs("add_scenario")), db: Session = Depends(get_db)):
        try:
            build_events(sc)
        except Exception as exc:
            raise HTTPException(422, f"events invalid: {str(exc)[:200]}")
        if any(s.id == sc.id for s in load_scenarios(scen_dir, ws=p.workspace_id)):
            raise HTTPException(409, "scenario id already exists")
        d = scen_dir / "custom" / str(p.workspace_id); d.mkdir(parents=True, exist_ok=True)
        (d / f"{sc.id}.json").write_text(sc.model_dump_json(indent=1))
        audit(db, p, "scenario_added", sc.id)
        return {"id": sc.id}

    return app

app = create_app()
