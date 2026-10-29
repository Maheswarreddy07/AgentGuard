import { useState } from "react";
import { State, api, useApi } from "../api";
function Detail({ id, back }) {
    const t = useApi(`/api/v1/traces/${id}`);
    const a = useApi(`/api/v1/traces/${id}/analysis`);
    const [rec, setRec] = useState(null);
  const [ai, setAi] = useState(null);
  async function diagnose() { try { setAi((await api(`/api/v1/traces/${id}/analyze`, { method: "POST" })).ai_diagnosis); } catch (e) { setAi({ status: "error", error: e.message }); } }
    const hit = new Set(a.data?.findings.flatMap((f) => f.evidence_event_ids) ?? []);
    async function recover() {
        try {
            const r = await api(`/api/v1/traces/${id}/recover`, { method: "POST", body: JSON.stringify({ sim: {} }) });
            setRec(`Simulated: ${r.decision.action} → ${r.outcome.terminal}. ${r.decision.reason}`);
            t.reload();
            a.reload();
        }
        catch (e) {
            setRec("Error: " + e.message);
        }
    }
    return (<>
    <button onClick={back}>← Back</button><h2>Trace {id}</h2>
    <State loading={t.loading || a.loading} error={t.error || a.error}/>
    {a.data && <div className="card"><h3>Investigation <span className="badge">deterministic rule results</span></h3>
      {a.data.findings.length === 0 ? <p>No findings.</p> : a.data.findings.map((f, i) => <div key={i}><b className={"sev-" + f.severity}>{f.severity.toUpperCase()}</b> {f.category} <span className="badge">{f.deterministic ? "proven by rule" : "heuristic"}</span>
        <div>{f.explanation}</div><small>Evidence: {f.evidence_event_ids.join(", ")} · Suggested: {f.recommended_action}</small></div>)}
      {a.data.localization.resolved ? <p>Origin: {a.data.localization.origin_event_id ?? "undetermined"} · First detectable: {a.data.localization.first_detectable_event_id} · Observed: {a.data.localization.observed_event_id}{a.data.localization.note && <> — <i>{a.data.localization.note}</i></>}</p> : <p>Localization unresolved: {a.data.localization.note}</p>}
      <div><button onClick={diagnose}>Request AI diagnosis (optional)</button>
        {ai && (ai.status === "ok" ? <div className="card"><h3>AI-generated hypothesis <span className="badge">not proven</span></h3><p>{ai.diagnosis.summary}</p><p><b>Likely:</b> {ai.diagnosis.likely_explanation}</p><p><b>Evidence:</b> {ai.diagnosis.supporting_evidence_event_ids.join(", ")} · <b>Confidence:</b> {ai.diagnosis.confidence} · Human review: {ai.diagnosis.needs_human_review ? "needed" : "not flagged"}</p><p><b>Limitations:</b> {ai.diagnosis.limitations}</p></div>
          : <p role="status">AI diagnosis: {ai.status}{ai.status === "disabled" ? " (no LLM provider configured; deterministic findings above are unaffected)" : ""}</p>)}</div>
      <button className="primary" onClick={recover}>Run safe recovery simulation</button> <span role="status">{rec}</span></div>}
    {t.data && <div className="card scroll"><h3>Timeline</h3><table><thead><tr><th>#</th><th>Type</th><th>Tool</th><th>Status</th><th>Input / output (redacted)</th></tr></thead><tbody>
      {t.data.events.map((e) => <tr key={e.event_id} className={hit.has(e.event_id) ? "hit" : ""}><td>{e.step_index}</td><td>{e.event_type}</td><td>{e.tool_name}</td><td>{e.status}{e.error_type && ` (${e.error_type})`}</td>
        <td><pre>{JSON.stringify({ in: e.tool_input, out: e.tool_output })}</pre></td></tr>)}</tbody></table><small>Highlighted rows are failure evidence.</small></div>}
  </>);
}
export default function Traces() {
    const [agent, setAgent] = useState("");
    const [sel, setSel] = useState(null);
    const ag = useApi("/api/v1/agents");
    const l = useApi(`/api/v1/traces?limit=50${agent ? `&agent=${encodeURIComponent(agent)}` : ""}`);
    if (sel)
        return <Detail id={sel} back={() => setSel(null)}/>;
    return (<><h2>Trace Explorer</h2>
    <label className="row">Agent <select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All</option>{ag.data?.items.map((a) => <option key={a}>{a}</option>)}</select></label>
    <State loading={l.loading} error={l.error}/>
    {l.data && (l.data.items.length === 0 ? <p className="empty">No traces match.</p> : <div className="card scroll"><table><thead><tr><th>Trace</th><th>Agent</th><th>Created</th></tr></thead><tbody>
      {l.data.items.map((t) => <tr key={t.trace_id}><td><button onClick={() => setSel(t.trace_id)}>{t.trace_id}</button></td><td>{t.agent_name}</td><td>{new Date(t.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>)}</>);
}
