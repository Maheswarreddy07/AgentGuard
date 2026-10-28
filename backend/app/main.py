import json, uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.db.models import BenchmarkRow, EventRow, TraceRow
from app.evaluation.runner import run_benchmark
from app.evaluation.scenario import Scenario, load_scenarios
from app.recovery.policy import decide, execute
from app.schemas.events import EventType
from app.db.session import make_engine, make_session_factory
from app.detectors.rules import run_all
from app.localization.locate import localize
from app.schemas.events import Event
from app.services.ingest import ingest, load_events

MAX_EVENTS_PER_REQUEST = 500

class TraceCreate(BaseModel):
    trace_id: str = Field(min_length=1, max_length=128)
    events: list[Event] = Field(default_factory=list, max_length=MAX_EVENTS_PER_REQUEST)

class EventBatch(BaseModel):
    events: list[Event] = Field(min_length=1, max_length=MAX_EVENTS_PER_REQUEST)

DEFAULT_SCENARIOS = Path(__file__).resolve().parents[2] / "benchmarks" / "scenarios"

class BenchRequest(BaseModel):
    scenario_ids: list[str] | None = None
    seed: int = 0

class RecoverRequest(BaseModel):
    sim: dict = Field(default_factory=dict)  # simulated environment only; no live actions are executed

def create_app(database_url: str | None = None, scenario_dir: Path | None = None) -> FastAPI:
    scen_dir = Path(scenario_dir or DEFAULT_SCENARIOS)
    app = FastAPI(title="AgentGuard", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    engine = make_engine(database_url)
    factory = make_session_factory(engine)

    def get_db():
        with factory() as s:
            yield s

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, __: Exception):  # never leak stack traces
        return JSONResponse(status_code=500, content={"error": {"code": "internal_error", "message": "Internal server error"}})

    @app.get("/health")
    def health(db: Session = Depends(get_db)):
        db.execute(select(1))
        return {"status": "ok", "database": "ok"}

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

    @app.get("/api/v1/traces")
    def list_traces(agent: str | None = None, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                    db: Session = Depends(get_db)):
        q = select(TraceRow)
        if agent:
            q = q.where(TraceRow.agent_name == agent)
        total = db.scalar(select(func.count()).select_from(q.subquery()))
        rows = db.scalars(q.order_by(TraceRow.created_at.desc()).limit(limit).offset(offset))
        return {"total": total, "limit": limit, "offset": offset,
                "items": [{"trace_id": r.trace_id, "agent_name": r.agent_name, "created_at": r.created_at} for r in rows]}

    @app.get("/api/v1/traces/{trace_id}")
    def get_trace(trace_id: str, db: Session = Depends(get_db)):
        if db.get(TraceRow, trace_id) is None:
            raise HTTPException(404, "trace not found")
        return {"trace_id": trace_id, "events": load_events(db, trace_id)}

    @app.get("/api/v1/traces/{trace_id}/analysis")
    def analysis(trace_id: str, db: Session = Depends(get_db)):
        if db.get(TraceRow, trace_id) is None:
            raise HTTPException(404, "trace not found")
        events = load_events(db, trace_id)
        findings = run_all(events)
        return {"trace_id": trace_id, "findings": findings, "localization": localize(events, findings),
                "ai_diagnosis": None, "note": "Findings are deterministic rule results; AI diagnosis not enabled."}

    @app.get("/api/v1/agents")
    def agents(db: Session = Depends(get_db)):
        return {"items": list(db.scalars(select(TraceRow.agent_name).distinct()))}

    @app.get("/api/v1/metrics/overview")
    def overview(db: Session = Depends(get_db)):
        ids = list(db.scalars(select(TraceRow.trace_id)))
        failed, by_cat = 0, {}
        for t in ids:
            f = run_all(load_events(db, t))
            failed += bool(f)
            for c in {x.category.value for x in f}:
                by_cat[c] = by_cat.get(c, 0) + 1
        n = len(ids)
        last = db.scalars(select(BenchmarkRow).where(BenchmarkRow.status == "completed").order_by(BenchmarkRow.created_at.desc())).first()
        bm = (last.result or {}).get("metrics") if last else None
        return {"live": {"total_runs": n, "runs_with_findings": failed, "failure_rate": (failed / n) if n else None, "by_category": by_cat},
                "benchmark": ({"source": "synthetic", "run_id": last.run_id, "detection": bm["detection"], "recovery": bm["recovery"],
                               "latency_ms": bm["latency_ms"]} if bm else None)}

    @app.get("/api/v1/settings")
    def settings():
        from app.recovery.policy import MAX_RETRIES
        return {"llm_configured": bool(os.getenv("LLM_API_KEY")), "llm_provider": os.getenv("LLM_PROVIDER") or None,
                "ai_diagnosis_enabled": False, "max_retries": MAX_RETRIES, "max_events_per_request": MAX_EVENTS_PER_REQUEST,
                "redaction": {"sensitive_keys": True, "emails": True, "api_keys": True, "ssn": True, "max_string_chars": 2000},
                "retention": "not enforced yet (no automatic deletion implemented)",
                "rules": [r.__name__ for r in __import__("app.detectors.rules", fromlist=["ALL_RULES"]).ALL_RULES]}

    @app.post("/api/v1/traces/{trace_id}/analyze")
    def analyze(trace_id: str, db: Session = Depends(get_db)):
        return analysis(trace_id, db)

    @app.post("/api/v1/traces/{trace_id}/recover")
    def recover(trace_id: str, body: RecoverRequest, db: Session = Depends(get_db)):
        if db.get(TraceRow, trace_id) is None:
            raise HTTPException(404, "trace not found")
        events = load_events(db, trace_id)
        before = run_all(events)
        dec = decide(events, before)
        out = execute(dec, body.sim)
        last = max(events, key=lambda e: e.step_index)
        rec = Event(trace_id=trace_id, run_id=last.run_id, event_id=f"recovery-{uuid.uuid4().hex[:8]}", agent_name=last.agent_name,
                    event_type=EventType.RECOVERY_ATTEMPT, timestamp=datetime.now(timezone.utc), step_index=last.step_index + 1,
                    metadata={"simulated": True, "action": dec.action, "recovered": out.recovered, "terminal": out.terminal})
        ingest(db, trace_id, [rec])
        return {"simulated": True, "decision": dec, "outcome": out, "findings_before": len(before),
                "note": "Simulation only. No live tool was executed; consequential actions always escalate."}

    def _run_bench(run_id: str, req: BenchRequest):
        with factory() as s:
            row = s.get(BenchmarkRow, run_id)
            try:
                scs = load_scenarios(scen_dir, set(req.scenario_ids) if req.scenario_ids else None)
                if not scs:
                    raise ValueError("no scenarios matched")
                row.result = json.loads(json.dumps(run_benchmark(scs, req.seed)))
                row.status = "completed"
            except Exception as exc:  # recorded without stack trace
                row.status, row.error = "failed", str(exc)[:300]
            row.finished_at = datetime.now(timezone.utc)
            s.commit()

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
        return {"items": [{"run_id": r.run_id, "status": r.status, "created_at": r.created_at, "finished_at": r.finished_at,
                           "metrics": (r.result or {}).get("metrics")} for r in rows]}

    @app.get("/api/v1/benchmarks/{run_id}")
    def get_bench(run_id: str, db: Session = Depends(get_db)):
        r = _bench(db, run_id)
        return {"run_id": r.run_id, "status": r.status, "error": r.error, "params": r.params, "label": (r.result or {}).get("label"),
                "metrics": (r.result or {}).get("metrics")}

    @app.get("/api/v1/benchmarks/{run_id}/results")
    def bench_results(run_id: str, db: Session = Depends(get_db)):
        r = _bench(db, run_id)
        if r.status != "completed":
            raise HTTPException(409, f"run is {r.status}")
        return {"run_id": run_id, "results": r.result["results"]}

    @app.get("/api/v1/scenarios")
    def scenarios():
        return {"items": [{"id": s.id, "category": s.category, "description": s.description, "labels": s.labels, "n_events": len(s.events)}
                          for s in load_scenarios(scen_dir)]}

    @app.post("/api/v1/scenarios", status_code=201)
    def add_scenario(sc: Scenario):
        build_ok = None
        try:
            from app.evaluation.runner import build_events
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
