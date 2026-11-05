import { useState } from "react";
import { paths, runApi, useApi, useAuth, useMeta } from "../api";
import ProblemDetails from "../components/ProblemDetails";
import TechnicalDetails from "../components/TechnicalDetails";
import Flow, { Inspector } from "../components/Flow";
import { Card, GOOD, Info, Kpi, SevBadge, State, BAD, sevColor } from "../ui";

const OUT = { recovered: ["✅", "Recovered automatically", GOOD], escalated: ["⚠️", "Handed to a human", "#ff9f43"], stopped: ["⛔", "Run stopped", BAD], none: ["•", "No action taken", "#8b93a7"] };

function Recovery({ id, reload }) {
  const { can } = useAuth();
  const plan = useApi(paths.recoveryPlan(id));
  const [sim, setSim] = useState({ transient_fail_count: 1, corrected_args_valid: true, evidence_available: true });
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  async function run() {
    setBusy(true); setErr(null);
    try { setRes(await runApi.recover(id, sim)); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  if (plan.loading || plan.error) return <State loading={plan.loading} error={plan.error} h={90} />;
  const p = plan.data, o = res && OUT[res.outcome.terminal];
  return (
    <Card title="What is safe to do next" hint="AgentGuard only ever previews or simulates here. It never executes a real tool.">
      <div className="plan"><div className="plan-a">{p.action_label}</div><p>{p.plain}</p><p className="muted">Why: {p.reason}</p></div>
      {p.action !== "none" && (
        <div className="simbox">
          <h4>Try it in a simulated environment</h4>
          {p.action === "retry" && <label className="field">How many retries will still fail first?<select value={sim.transient_fail_count} onChange={(e) => setSim({ ...sim, transient_fail_count: +e.target.value })}>{[0, 1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}{n >= 3 ? " (exceeds the limit of 3)" : ""}</option>)}</select></label>}
          {p.action === "correct_args" && <label className="check"><input type="checkbox" checked={sim.corrected_args_valid} onChange={(e) => setSim({ ...sim, corrected_args_valid: e.target.checked })} />The corrected arguments turn out to be valid</label>}
          {p.action === "request_evidence" && <label className="check"><input type="checkbox" checked={sim.evidence_available} onChange={(e) => setSim({ ...sim, evidence_available: e.target.checked })} />The missing evidence is available</label>}
          {["escalate", "stop"].includes(p.action) && <p className="muted">This outcome never depends on the environment: a human decides.</p>}
          <button className="btn primary" disabled={busy || !can("member")} title={can("member") ? "" : "Members and admins can run simulations"} onClick={run}>{busy ? "Simulating…" : "Run simulation"}</button>{!can("member") && <span className="muted small">Viewers can read the plan but not run simulations.</span>}
          {err && <p role="alert" className="alert">{err}</p>}
          {res && <div className="outcome" style={{ "--c": o[2] }} role="status"><span className="big">{o[0]}</span><div><b>{o[1]}</b><div className="muted">{res.outcome.attempts ? `${res.outcome.attempts} attempt(s). ` : ""}{res.note}</div></div></div>}
        </div>)}
    </Card>
  );
}

function AiCard({ id }) {
  const { can } = useAuth();
  const [ai, setAi] = useState(null), [busy, setBusy] = useState(false);
  async function ask() { setBusy(true); try { setAi((await runApi.analyze(id)).ai_diagnosis); } catch (e) { setAi({ status: "error", error: e.message }); } finally { setBusy(false); } }
  return (
    <Card title="AI second opinion (optional)" hint="A language model reads only the relevant redacted events and offers a hypothesis. It is never treated as proof and never triggers actions.">
      <button className="btn" disabled={busy || !can("member")} onClick={ask}>{busy ? "Asking…" : "Ask the AI to explain"}</button>
      {ai && (ai.status === "ok" ? (
        <div className="ai"><span className="badge">AI hypothesis — not proven</span><p>{ai.diagnosis.summary}</p><p><b>Likely cause:</b> {ai.diagnosis.likely_explanation}</p>
          <p><b>Cited steps:</b> {ai.diagnosis.supporting_evidence_event_ids.join(", ")} · <b>Confidence:</b> {ai.diagnosis.confidence} · {ai.diagnosis.needs_human_review ? "Human review recommended" : "No review flagged"}</p><p className="muted">Limits: {ai.diagnosis.limitations}</p></div>
      ) : <p role="status" className="muted">{ai.status === "disabled" ? "AI diagnosis isn’t configured, which is fine — every finding above comes from deterministic rules." : `AI diagnosis unavailable (${ai.status}).`}</p>)}
    </Card>
  );
}

export default function TraceDetail({ id }) {
  const meta = useMeta();
  const t = useApi(paths.trace(id)), a = useApi(paths.analysis(id));
  const [sel, setSel] = useState(null);
  if (!t.data || !a.data) return <><a className="back" href="#/traces">← All traces</a><State loading={t.loading || a.loading} error={t.error || a.error} h={300} /></>;
  const events = t.data.events, A = a.data, loc = A.localization;
  const markers = {};
  [[loc.origin_event_id, "Origin"], [loc.first_detectable_event_id, "First detectable"], [loc.observed_event_id, "Observed"]].forEach(([eid, m]) => { if (eid) (markers[eid] ??= []).push(m); });
  const evidence = new Set(A.findings.flatMap((f) => f.evidence_event_ids));
  const reload = () => { t.reload(); a.reload(); };
  return (
    <div className="stack">
      <a className="back" href="#/traces">← All traces</a>
      <Card className="summary" >
        <div className="row"><h2 className="mono">{id}</h2><SevBadge sev={A.summary.max_severity} /><span className="badge">{events.length} steps</span></div>
        <p className="lead">{A.summary.headline}</p>
      </Card>

      <div className="kpis">
        <Kpi label="Outcome" value={t.data.outcome} sub={t.data.mode ? `${t.data.mode} mode · ${t.data.environment ?? "no environment"}` : undefined} />
        <Kpi label="Risk score" value={t.data.risk_score} sub="highest reached" tone={t.data.risk_score >= 50 ? BAD : undefined} />
        <Kpi label="Actions blocked" value={t.data.blocked_actions} tone={t.data.blocked_actions ? BAD : undefined} />
        <Kpi label="Tool calls" value={t.data.tool_calls} sub={t.data.duration_ms == null ? "still running" : `${(t.data.duration_ms / 1000).toFixed(1)} s`} />
        <Kpi label="Tokens / cost" value={t.data.tokens} sub={`$${t.data.cost_usd.toFixed(4)}`} />
      </div>
      {t.data.task && <p className="muted">Task given to the agent: <b>{t.data.task}</b></p>}

      <Card title="What happened" hint="Each box is one step of the run, left to right. Red = error. Outlined = evidence for a finding. Click any step to inspect it.">
        <Flow events={events} markers={markers} evidence={evidence} selected={sel} onSelect={setSel} />
        {loc.resolved ? (
          <div className="legend-row">
            <span><span className="mark m-origin">Origin</span> where the problem started{loc.origin_event_id ? "" : " — not determinable from the recorded evidence"}</span>
            <span><span className="mark m-first">First detectable</span> earliest step at which a rule could prove it</span>
            <span><span className="mark m-observed">Observed</span> last step that shows it</span>
          </div>
        ) : <p className="muted">No failure to localize.</p>}
        <Inspector event={events.find((e) => e.event_id === sel)} findings={A.findings} />
      </Card>

      <Card title={`Findings (${A.findings.length})`} hint="Each finding comes from an explicit rule, so it is a proven violation of that rule — not a guess.">
        {A.findings.length === 0 ? <p className="muted">✅ No rule found a problem in this run.</p> : A.findings.map((f) => <ProblemDetails key={f.id} problem={f} selectedEventId={sel} onSelectEvent={setSel} stepOf={(eid) => events.find((e) => e.event_id === eid)?.step_index} />)}
      </Card>

      {events.some((e) => e.event_type === "policy_check") && <Card title="Policy decisions" sub="Each check happened BEFORE the tool was allowed to run">
        <ul className="plain">{events.filter((e) => e.event_type === "policy_check").map((e) => <li key={e.event_id}><button className="linkbtn" onClick={() => setSel(e.event_id)}>step {e.step_index}</button> <b>{e.tool_name}</b>: <span className="badge sev" style={{ "--c": e.metadata.effective === "ALLOW" ? GOOD : BAD }}>{e.metadata.effective.replace(/_/g, " ")}</span>
          {e.metadata.mode !== "enforce" && <span className="muted small"> ({e.metadata.mode} mode{e.metadata.decision !== e.metadata.effective ? `; enforce mode would have said ${e.metadata.decision.replace(/_/g, " ")}` : ""})</span>} <span className="muted">{e.metadata.reason}</span></li>)}</ul></Card>}
      {events.some((e) => e.event_type === "risk_detected") && <Card title="Risk warnings" sub="Predicted before the action ran — separate from confirmed findings above">
        {events.filter((e) => e.event_type === "risk_detected").map((e) => <article key={e.event_id} className="finding" style={{ "--c": sevColor(e.metadata.level) }}><div className="row"><b>Score {e.metadata.score}</b><SevBadge sev={e.metadata.level} /><span className="badge">predicted, not confirmed</span></div>
          <ul className="plain small">{e.metadata.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></article>)}</Card>}

      <TechnicalDetails title="Technical details: every recorded event" data={events} />
      <Recovery id={id} reload={reload} />
      <AiCard id={id} />
    </div>
  );
}
