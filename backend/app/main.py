import json, os, time, uuid
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin_routes, auth_routes, runtime_routes
from app.api.deps import Principal, audit, get_db, require, require_agent
from app.auth import hash_password
from app.catalog import ACTIONS, CATEGORIES, SEV_RANK, meta
from app.db.models import ApprovalRow, BenchmarkRow, EventRow, TraceRow, UserRow, WorkspaceRow
from app.db.session import make_engine, make_session_factory
from app.detectors.rules import run_all
from app.evaluation.runner import build_events, run_benchmark
from app.evaluation.scenario import Scenario, load_scenarios
from app.localization.locate import localize
from app.recovery.policy import decide, execute
from app.schemas.events import Event, EventType
from app.services.demo import seed_demo
from app.services.diagnosis import diagnose, provider_from_env
from app.services.ingest import backfill_summaries, finding_id, get_trace, ingest, load_events
from app.services.retention import purge_older_than
from app.services.settings import load_config

MAX_EVENTS_PER_REQUEST = 500
DEFAULT_SCENARIOS = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"
Sev = Literal["info", "low", "medium", "high", "critical"]

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
    async def rate_limiter(request: Request, call_next):
        limit = st.rate_limit_override if st.rate_limit_override is not None else st.cfg.rate_limit_per_min
        if limit > 0 and request.url.path != "/health" and request.method != "OPTIONS":
            ip, now = (request.client.host if request.client else "?"), time.monotonic()
            q = hits[ip]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                r = _err(429, "rate_limited", "Too many requests — slow down and try again in a minute."); r.headers["Retry-After"] = "60"; return r
            q.append(now)
        return await call_next(request)

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
    def get_meta(_: Principal = Depends(require("viewer"))): return meta()

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
    def demo_seed(p: Principal = Depends(require("member")), db: Session = Depends(get_db)):
        n = seed_demo(db, p.workspace_id, scen_dir); audit(db, p, "demo_seeded", None, {"new_traces": n})
        return {"seeded": n, "note": "Synthetic demo traces."}

    # ---------- exploring traces ----------
    @app.get("/api/v1/traces")
    def list_traces(agent: str | None = None, status: Literal["clean", "flagged"] | None = None, severity: Sev | None = None, outcome: str | None = None, environment: str | None = None,
                    category: str | None = None, q: str | None = Query(None, max_length=100), date_from: date | None = None, date_to: date | None = None,
                    sort: Literal["newest", "severity", "events", "risk"] = "newest", limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                    p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        rows = list(db.scalars(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id)))
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
    def facets(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        rows = list(db.scalars(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id))); cat, sev, ag, env, out = (defaultdict(int) for _ in range(5))
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

    @app.get("/api/v1/traces/{trace_id}/analysis")
    def analysis(trace_id: str, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        return build_analysis(db, p.workspace_id, trace_id)[3]

    @app.post("/api/v1/traces/{trace_id}/analyze")
    def analyze(trace_id: str, p: Principal = Depends(require("member")), db: Session = Depends(get_db)):
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
    def recover(trace_id: str, body: RecoverRequest, p: Principal = Depends(require("member")), db: Session = Depends(get_db)):
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
                 date_from: date | None = None, date_to: date | None = None, p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        ws = p.workspace_id; rows = list(db.scalars(select(TraceRow).where(TraceRow.workspace_id == ws)))
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
        pending = db.scalar(select(func.count()).select_from(ApprovalRow).where(ApprovalRow.workspace_id == ws, ApprovalRow.status == "pending"))
        crit = sum(1 for r in rows if (r.category_severity or {}) and "critical" in (r.category_severity or {}).values())
        return {"live": {"total_runs": n, "runs_with_findings": flagged, "clean_runs": n - flagged, "failure_rate": (flagged / n) if n else None, "successful_runs": sum(r.outcome == "succeeded" for r in rows), "failed_runs": sum(r.outcome == "failed" for r in rows),
                         "blocked_runs": sum(r.outcome == "blocked" for r in rows), "running_runs": sum(r.outcome == "running" for r in rows), "risky_runs": sum((r.risk_score or 0) >= st.cfg.risk_alert_threshold for r in rows), "critical_runs": crit,
                         "blocked_actions": sum(r.blocked_actions for r in rows), "pending_approvals": pending, "recovery_attempts": sum(r.recovery_attempts for r in rows),
                         "avg_duration_ms": (sum(r.duration_ms for r in done) / len(done)) if done else None, "avg_risk": (sum(r.risk_score for r in rows) / n) if n else None, "total_cost_usd": round(sum(r.cost_usd for r in rows), 4),
                         "by_category": dict(by_cat), "category_stats": {c: {"count": by_cat[c], "max_severity": cat_sev.get(c)} for c in by_cat}, "by_severity": dict(by_sev), "recent_incidents": [brief(r) for r in inc]},
                "benchmark": ({"source": "synthetic", "run_id": last.run_id, "at": last.finished_at, "n_scenarios": bm["n_scenarios"], "detection": bm["detection"], "recovery": bm["recovery"], "outcomes": bm["outcomes"], "latency_ms": bm["latency_ms"]} if bm else None)}

    @app.get("/api/v1/metrics/trends")
    def trends(p: Principal = Depends(require("viewer")), db: Session = Depends(get_db)):
        days: dict[str, dict] = {}
        for t in db.scalars(select(TraceRow).where(TraceRow.workspace_id == p.workspace_id)):
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
                row.result = json.loads(json.dumps(run_benchmark(scs, req.seed, load_config(s, ws)))); row.status = "completed"
            except Exception as exc:  # recorded without stack trace
                row.status, row.error = "failed", str(exc)[:300]
            row.finished_at = datetime.now(timezone.utc); s.commit()

    @app.post("/api/v1/benchmarks/run", status_code=202)
    def run_bench(req: BenchRequest, bg: BackgroundTasks, p: Principal = Depends(require("member")), db: Session = Depends(get_db)):
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
        ma, mb = ra.result["metrics"], rb.result["metrics"]
        pick = {"precision": lambda m: m["detection"]["micro_precision"], "recall": lambda m: m["detection"]["micro_recall"], "false_positive_rate": lambda m: m["detection"]["false_positive_rate"],
                "localization": lambda m: m["localization"]["accuracy"], "task_success": lambda m: m["outcomes"]["protected_task_success"], "safe_outcome": lambda m: m["outcomes"]["protected_safe_outcome"],
                "recovery_success": lambda m: m["recovery"]["recovery_success_rate"], "latency": lambda m: m["latency_ms"]["mean_added"]}
        rows = []
        for k, fn in pick.items():
            va, vb = fn(ma), fn(mb); rows.append({"metric": k, "a": va, "b": vb, "delta": (vb - va) if va is not None and vb is not None else None})
        return {"a": a, "b": b, "rows": rows}

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

    @app.post("/api/v1/scenarios", status_code=201)
    def add_scenario(sc: Scenario, p: Principal = Depends(require("member")), db: Session = Depends(get_db)):
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
