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
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.catalog import ACTIONS, CATEGORIES, SEV_RANK, meta
from app.db.models import BenchmarkRow, TraceRow
from app.db.session import make_engine, make_session_factory
from app.detectors.rules import ALL_RULES, run_all
from app.evaluation.runner import build_events, run_benchmark
from app.evaluation.scenario import Scenario, load_scenarios
from app.localization.locate import localize
from app.recovery.policy import MAX_RETRIES, decide, execute
from app.schemas.events import Event, EventType
from app.services.demo import seed_demo
from app.services.diagnosis import diagnose, provider_from_env
from app.services.ingest import backfill_summaries, ingest, load_events
from app.services.retention import purge_older_than

MAX_EVENTS_PER_REQUEST = 500
DEFAULT_SCENARIOS = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"
Sev = Literal["low", "medium", "high", "critical"]

class TraceCreate(BaseModel):
    trace_id: str = Field(min_length=1, max_length=128)
    events: list[Event] = Field(default_factory=list, max_length=MAX_EVENTS_PER_REQUEST)

class EventBatch(BaseModel):
    events: list[Event] = Field(min_length=1, max_length=MAX_EVENTS_PER_REQUEST)

class BenchRequest(BaseModel):
    scenario_ids: list[str] | None = None
    seed: int = 0

class RecoverRequest(BaseModel):
    sim: dict = Field(default_factory=dict)  # simulated environment only; no live actions are executed

def _err(status: int, code: str, message: str, **extra):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, **extra}})

def enrich(f) -> dict:
    d = f.model_dump(mode="json"); c = CATEGORIES.get(d["category"], {})
    return {**d, "label": c.get("label", d["category"]), "why": c.get("why"), "fix": c.get("fix"), "proof": "rule" if d["deterministic"] else "heuristic"}

def create_app(database_url: str | None = None, scenario_dir: Path | None = None, llm=None, rate_limit: int | None = None) -> FastAPI:
    scen_dir = Path(scenario_dir or DEFAULT_SCENARIOS)
    app = FastAPI(title="AgentGuard", version="0.2.0")
    app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    factory = make_session_factory(make_engine(database_url))
    llm_provider = llm if llm is not None else provider_from_env()
    retention_days = int(os.getenv("RETENTION_DAYS", "0"))
    limit = rate_limit if rate_limit is not None else int(os.getenv("RATE_LIMIT_PER_MIN", "600"))
    hits: dict[str, deque] = defaultdict(deque)
    with factory() as s:  # startup housekeeping
        backfill_summaries(s)
        purge_older_than(s, retention_days)

    def get_db():
        with factory() as s:
            yield s

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
        if limit > 0 and request.url.path != "/health":
            ip, now = (request.client.host if request.client else "?"), time.monotonic()
            q = hits[ip]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                r = _err(429, "rate_limited", "Too many requests"); r.headers["Retry-After"] = "60"; return r
            q.append(now)
        return await call_next(request)

    def trace_or_404(db: Session, trace_id: str) -> TraceRow:
        t = db.get(TraceRow, trace_id)
        if t is None:
            raise HTTPException(404, "trace not found")
        return t

    def brief(t: TraceRow) -> dict:
        return {"trace_id": t.trace_id, "agent_name": t.agent_name, "created_at": t.created_at, "n_events": t.n_events, "status": t.status,
                "max_severity": t.max_severity, "categories": t.categories or [], "headline": t.headline}

    # ---------- meta / health / settings ----------
    @app.get("/health")
    def health(db: Session = Depends(get_db)):
        db.execute(select(1))
        return {"status": "ok", "database": "ok", "version": app.version}

    @app.get("/api/v1/meta")
    def get_meta(): return meta()

    @app.get("/api/v1/settings")
    def settings():
        return {"llm_configured": bool(os.getenv("LLM_API_KEY")), "llm_provider": os.getenv("LLM_PROVIDER") or None,
                "ai_diagnosis_enabled": llm_provider is not None, "rate_limit_per_min": limit, "max_retries": MAX_RETRIES,
                "max_events_per_request": MAX_EVENTS_PER_REQUEST,
                "redaction": {"sensitive_keys": True, "emails": True, "api_keys": True, "ssn": True, "max_string_chars": 2000},
                "retention": f"{retention_days} days, enforced at startup" if retention_days > 0 else "disabled (set RETENTION_DAYS)",
                "rules": [r.__name__ for r in ALL_RULES]}

    # ---------- ingestion ----------
    @app.post("/api/v1/traces", status_code=201)
    def create_trace(body: TraceCreate, db: Session = Depends(get_db)):
        try:
            return {"trace_id": body.trace_id, **ingest(db, body.trace_id, body.events)}
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/v1/traces/{trace_id}/events", status_code=202)
    def add_events(trace_id: str, body: EventBatch, db: Session = Depends(get_db)):
        try:
            return ingest(db, trace_id, body.events)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/v1/demo/seed")
    def demo_seed(db: Session = Depends(get_db)):
        return {"seeded": seed_demo(db, scen_dir), "note": "Synthetic demo traces."}

    # ---------- exploring traces ----------
    @app.get("/api/v1/traces")
    def list_traces(agent: str | None = None, status: Literal["clean", "flagged"] | None = None, severity: Sev | None = None,
                    category: str | None = None, q: str | None = Query(None, max_length=100), date_from: date | None = None, date_to: date | None = None,
                    sort: Literal["newest", "severity", "events"] = "newest", limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                    db: Session = Depends(get_db)):
        rows = list(db.scalars(select(TraceRow)))
        rows = [r for r in rows if (not agent or r.agent_name == agent) and (not status or r.status == status) and (not severity or r.max_severity == severity)
                and (not category or category in (r.categories or [])) and (not q or q.lower() in r.trace_id.lower())
                and (not date_from or r.created_at.date() >= date_from) and (not date_to or r.created_at.date() <= date_to)]
        key = {"newest": lambda r: r.created_at, "severity": lambda r: (SEV_RANK.get(r.max_severity or "", 0), r.created_at), "events": lambda r: r.n_events or 0}[sort]
        rows.sort(key=key, reverse=True)
        return {"total": len(rows), "limit": limit, "offset": offset, "items": [brief(r) for r in rows[offset:offset + limit]]}

    @app.get("/api/v1/traces/facets")
    def facets(db: Session = Depends(get_db)):
        rows = list(db.scalars(select(TraceRow))); cat, sev, ag = defaultdict(int), defaultdict(int), defaultdict(int)
        for r in rows:
            ag[r.agent_name] += 1
            if r.max_severity: sev[r.max_severity] += 1
            for c in r.categories or []: cat[c] += 1
        return {"total": len(rows), "flagged": sum(r.status == "flagged" for r in rows), "clean": sum(r.status == "clean" for r in rows),
                "severity": dict(sev), "category": dict(cat), "agent": dict(ag)}

    @app.get("/api/v1/traces/{trace_id}")
    def get_trace(trace_id: str, db: Session = Depends(get_db)):
        t = trace_or_404(db, trace_id)
        return {**brief(t), "events": load_events(db, trace_id)}

    def build_analysis(db: Session, trace_id: str):
        trace_or_404(db, trace_id)
        events = load_events(db, trace_id); findings = run_all(events)
        loc = localize(events, findings); top = max(findings, key=lambda f: SEV_RANK[f.severity.value], default=None)
        return events, findings, {"trace_id": trace_id, "findings": [enrich(f) for f in findings], "localization": loc, "ai_diagnosis": None,
                                  "summary": {"status": "flagged" if findings else "clean", "headline": top.explanation if top else "No issues detected by the rules.",
                                              "max_severity": top.severity.value if top else None, "n_findings": len(findings), "n_events": len(events)}}

    @app.get("/api/v1/traces/{trace_id}/analysis")
    def analysis(trace_id: str, db: Session = Depends(get_db)):
        return build_analysis(db, trace_id)[2]

    @app.post("/api/v1/traces/{trace_id}/analyze")
    def analyze(trace_id: str, db: Session = Depends(get_db)):
        events, findings, out = build_analysis(db, trace_id)
        out["ai_diagnosis"] = diagnose(llm_provider, events, findings)
        return out

    @app.get("/api/v1/traces/{trace_id}/recovery-plan")
    def recovery_plan(trace_id: str, db: Session = Depends(get_db)):
        events, findings, _ = build_analysis(db, trace_id)
        d = decide(events, findings)
        return {"action": d.action, "action_label": ACTIONS[d.action]["label"], "plain": ACTIONS[d.action]["plain"], "reason": d.reason, "max_attempts": d.max_attempts,
                "executes_anything": False, "safety": "Consequential actions are never retried automatically; they always go to a human."}

    @app.post("/api/v1/traces/{trace_id}/recover")
    def recover(trace_id: str, body: RecoverRequest, db: Session = Depends(get_db)):
        events, findings, _ = build_analysis(db, trace_id)
        dec = decide(events, findings); out = execute(dec, body.sim); last = max(events, key=lambda e: e.step_index)
        rec = Event(trace_id=trace_id, run_id=last.run_id, event_id=f"recovery-{uuid.uuid4().hex[:8]}", agent_name=last.agent_name, event_type=EventType.RECOVERY_ATTEMPT,
                    timestamp=datetime.now(timezone.utc), step_index=last.step_index + 1,
                    metadata={"simulated": True, "action": dec.action, "recovered": out.recovered, "terminal": out.terminal})
        ingest(db, trace_id, [rec])
        return {"simulated": True, "decision": dec, "action_label": ACTIONS[dec.action]["label"], "outcome": out, "findings_before": len(findings),
                "note": "Simulation only. No live tool was executed; consequential actions always escalate."}

    @app.get("/api/v1/agents")
    def agents(db: Session = Depends(get_db)):
        return {"items": sorted(set(db.scalars(select(TraceRow.agent_name))))}

    # ---------- metrics ----------
    @app.get("/api/v1/metrics/overview")
    def overview(db: Session = Depends(get_db)):
        rows = list(db.scalars(select(TraceRow))); by_cat, by_sev = defaultdict(int), defaultdict(int)
        for r in rows:
            if r.max_severity: by_sev[r.max_severity] += 1
            for c in r.categories or []: by_cat[c] += 1
        flagged = sum(r.status == "flagged" for r in rows); n = len(rows)
        inc = sorted([r for r in rows if r.max_severity in ("high", "critical")], key=lambda r: (SEV_RANK[r.max_severity], r.updated_at or r.created_at), reverse=True)[:6]
        last = db.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "completed").order_by(BenchmarkRow.created_at.desc())).first()
        bm = (last.result or {}).get("metrics") if last else None
        return {"live": {"total_runs": n, "runs_with_findings": flagged, "clean_runs": n - flagged, "failure_rate": (flagged / n) if n else None,
                         "by_category": dict(by_cat), "by_severity": dict(by_sev), "recent_incidents": [brief(r) for r in inc]},
                "benchmark": ({"source": "synthetic", "run_id": last.run_id, "n_scenarios": bm["n_scenarios"], "detection": bm["detection"], "recovery": bm["recovery"],
                               "outcomes": bm["outcomes"], "latency_ms": bm["latency_ms"]} if bm else None)}

    @app.get("/api/v1/metrics/trends")
    def trends(db: Session = Depends(get_db)):
        days: dict[str, dict] = {}
        for t in db.scalars(select(TraceRow)):
            k = t.created_at.date().isoformat(); d = days.setdefault(k, {"date": k, "runs": 0, "with_findings": 0})
            d["runs"] += 1; d["with_findings"] += t.status == "flagged"
        return {"items": [days[k] for k in sorted(days)]}

    # ---------- benchmarks ----------
    def _run_bench(run_id: str, req: BenchRequest):
        with factory() as s:
            row = s.get(BenchmarkRow, run_id)
            try:
                scs = load_scenarios(scen_dir, set(req.scenario_ids) if req.scenario_ids else None)
                if not scs:
                    raise ValueError("no scenarios matched")
                row.result = json.loads(json.dumps(run_benchmark(scs, req.seed))); row.status = "completed"
            except Exception as exc:  # recorded without stack trace
                row.status, row.error = "failed", str(exc)[:300]
            row.finished_at = datetime.now(timezone.utc); s.commit()

    @app.post("/api/v1/benchmarks/run", status_code=202)
    def run_bench(req: BenchRequest, bg: BackgroundTasks, db: Session = Depends(get_db)):
        run_id = uuid.uuid4().hex[:12]
        db.add(BenchmarkRow(run_id=run_id, status="running", params=req.model_dump())); db.commit()
        bg.add_task(_run_bench, run_id, req)  # status flips to completed only after the run really finishes
        return {"run_id": run_id, "status": "running"}

    def _bench(db, run_id):
        row = db.get(BenchmarkRow, run_id)
        if row is None:
            raise HTTPException(404, "benchmark run not found")
        return row

    @app.get("/api/v1/benchmarks")
    def list_bench(db: Session = Depends(get_db)):
        rows = db.scalars(select(BenchmarkRow).order_by(BenchmarkRow.created_at.desc()).limit(50))
        return {"items": [{"run_id": r.run_id, "status": r.status, "created_at": r.created_at, "finished_at": r.finished_at, "params": r.params,
                           "n_scenarios": ((r.result or {}).get("metrics") or {}).get("n_scenarios"),
                           "headline": ({"safe_protected": r.result["metrics"]["outcomes"]["protected_safe_outcome"], "safe_baseline": r.result["metrics"]["outcomes"]["baseline_safe_outcome"]} if r.result else None)} for r in rows]}

    @app.get("/api/v1/benchmark-compare")
    def compare(a: str, b: str, db: Session = Depends(get_db)):
        ra, rb = _bench(db, a), _bench(db, b)
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
    def get_bench(run_id: str, db: Session = Depends(get_db)):
        r = _bench(db, run_id)
        return {"run_id": r.run_id, "status": r.status, "error": r.error, "params": r.params, "label": (r.result or {}).get("label"), "metrics": (r.result or {}).get("metrics")}

    @app.get("/api/v1/benchmarks/{run_id}/results")
    def bench_results(run_id: str, only: Literal["all", "mistakes"] = "all", db: Session = Depends(get_db)):
        r = _bench(db, run_id)
        if r.status != "completed":
            raise HTTPException(409, f"run is {r.status}")
        res = r.result["results"]
        if only == "mistakes":
            res = [x for x in res if sorted(x["true"]) != sorted(x["pred"])]
        return {"run_id": run_id, "results": res}

    # ---------- scenarios ----------
    @app.get("/api/v1/scenarios")
    def scenarios():
        return {"items": [{"id": s.id, "category": s.category, "description": s.description, "labels": s.labels, "n_events": len(s.events)} for s in load_scenarios(scen_dir)]}

    @app.get("/api/v1/scenarios/{scenario_id}")
    def scenario(scenario_id: str):
        s = next((x for x in load_scenarios(scen_dir) if x.id == scenario_id), None)
        if s is None:
            raise HTTPException(404, "scenario not found")
        return {**s.model_dump(), "events": [e.model_dump(mode="json") for e in build_events(s)]}

    @app.post("/api/v1/scenarios", status_code=201)
    def add_scenario(sc: Scenario):
        try:
            build_events(sc)
        except Exception as exc:
            raise HTTPException(422, f"events invalid: {str(exc)[:200]}")
        if any(s.id == sc.id for s in load_scenarios(scen_dir)):
            raise HTTPException(409, "scenario id already exists")
        d = scen_dir / "custom"; d.mkdir(parents=True, exist_ok=True)
        (d / f"{sc.id}.json").write_text(sc.model_dump_json(indent=1))
        return {"id": sc.id}

    return app

app = create_app()
