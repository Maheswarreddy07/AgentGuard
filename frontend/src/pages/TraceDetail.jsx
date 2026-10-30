import { useState } from "react";
import { api, useApi, useMeta } from "../api";
import Flow, { Inspector } from "../components/Flow";
import { Card, GOOD, Info, SEV, SevBadge, State, BAD } from "../ui";

const OUT = { recovered: ["✅", "Recovered automatically", GOOD], escalated: ["⚠️", "Handed to a human", "#ff9f43"], stopped: ["⛔", "Run stopped", BAD], none: ["•", "No action taken", "#8b93a7"] };

function Recovery({ id, reload }) {
  const plan = useApi(`/api/v1/traces/${id}/recovery-plan`);
  const [sim, setSim] = useState({ transient_fail_count: 1, corrected_args_valid: true, evidence_available: true });
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  async function run() {
    setBusy(true); setErr(null);
    try { setRes(await api(`/api/v1/traces/${id}/recover`, { method: "POST", body: JSON.stringify({ sim }) })); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
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
          <button className="btn primary" disabled={busy} onClick={run}>{busy ? "Simulating…" : "Run simulation"}</button>
          {err && <p role="alert" className="alert">{err}</p>}
          {res && <div className="outcome" style={{ "--c": o[2] }} role="status"><span className="big">{o[0]}</span><div><b>{o[1]}</b><div className="muted">{res.outcome.attempts ? `${res.outcome.attempts} attempt(s). ` : ""}{res.note}</div></div></div>}
        </div>)}
    </Card>
  );
}

function AiCard({ id }) {
  const [ai, setAi] = useState(null), [busy, setBusy] = useState(false);
  async function ask() { setBusy(true); try { setAi((await api(`/api/v1/traces/${id}/analyze`, { method: "POST" })).ai_diagnosis); } catch (e) { setAi({ status: "error", error: e.message }); } finally { setBusy(false); } }
  return (
    <Card title="AI second opinion (optional)" hint="A language model reads only the relevant redacted events and offers a hypothesis. It is never treated as proof and never triggers actions.">
      <button className="btn" disabled={busy} onClick={ask}>{busy ? "Asking…" : "Ask the AI to explain"}</button>
      {ai && (ai.status === "ok" ? (
        <div className="ai"><span className="badge">AI hypothesis — not proven</span><p>{ai.diagnosis.summary}</p><p><b>Likely cause:</b> {ai.diagnosis.likely_explanation}</p>
          <p><b>Cited steps:</b> {ai.diagnosis.supporting_evidence_event_ids.join(", ")} · <b>Confidence:</b> {ai.diagnosis.confidence} · {ai.diagnosis.needs_human_review ? "Human review recommended" : "No review flagged"}</p><p className="muted">Limits: {ai.diagnosis.limitations}</p></div>
      ) : <p role="status" className="muted">{ai.status === "disabled" ? "AI diagnosis isn’t configured, which is fine — every finding above comes from deterministic rules." : `AI diagnosis unavailable (${ai.status}).`}</p>)}
    </Card>
  );
}

export default function TraceDetail({ id }) {
  const meta = useMeta();
  const t = useApi(`/api/v1/traces/${encodeURIComponent(id)}`), a = useApi(`/api/v1/traces/${encodeURIComponent(id)}/analysis`);
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
        {A.findings.length === 0 ? <p className="muted">✅ No rule found a problem in this run.</p> : A.findings.map((f, i) => (
          <article className="finding" key={i} style={{ "--c": SEV[f.severity] }}>
            <div className="row"><b>{f.label}</b><SevBadge sev={f.severity} /><span className="badge">{f.proof === "rule" ? "proven by rule" : "heuristic"}</span></div>
            <p>{f.explanation}</p>
            <p className="muted"><b>Why it matters:</b> {f.why}</p>
            <p className="muted"><b>Suggested fix:</b> {f.fix}</p>
            <div className="chips"><span className="muted">Evidence:</span>{f.evidence_event_ids.map((eid) => <button key={eid} className="tag btnlike" onClick={() => setSel(eid)}>step {events.find((e) => e.event_id === eid)?.step_index ?? "?"}</button>)}</div>
          </article>))}
      </Card>

      <Recovery id={id} reload={reload} />
      <AiCard id={id} />
    </div>
  );
}
