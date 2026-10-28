import { useState } from "react";
import { State, api, useApi } from "../api";
interface Ev { event_id: string; step_index: number; event_type: string; tool_name?: string; status: string; error_type?: string; tool_input?: unknown; tool_output?: unknown }
interface Finding { category: string; severity: string; evidence_event_ids: string[]; explanation: string; deterministic: boolean; recommended_action: string }
interface Analysis { findings: Finding[]; localization: { resolved: boolean; origin_event_id: string | null; first_detectable_event_id: string | null; observed_event_id: string | null; note: string }; ai_diagnosis: null }
function Detail({ id, back }: { id: string; back: () => void }) {
  const t = useApi<{ events: Ev[] }>(`/api/v1/traces/${id}`);
  const a = useApi<Analysis>(`/api/v1/traces/${id}/analysis`);
  const [rec, setRec] = useState<string | null>(null);
  const hit = new Set(a.data?.findings.flatMap((f) => f.evidence_event_ids) ?? []);
  async function recover() {
    try { const r = await api<{ decision: { action: string; reason: string }; outcome: { terminal: string } }>(`/api/v1/traces/${id}/recover`, { method: "POST", body: JSON.stringify({ sim: {} }) });
      setRec(`Simulated: ${r.decision.action} → ${r.outcome.terminal}. ${r.decision.reason}`); t.reload(); a.reload(); } catch (e) { setRec("Error: " + (e as Error).message); }
  }
  return (<>
    <button onClick={back}>← Back</button><h2>Trace {id}</h2>
    <State loading={t.loading || a.loading} error={t.error || a.error} />
    {a.data && <div className="card"><h3>Investigation <span className="badge">deterministic rule results</span></h3>
      {a.data.findings.length === 0 ? <p>No findings.</p> : a.data.findings.map((f, i) => <div key={i}><b className={"sev-" + f.severity}>{f.severity.toUpperCase()}</b> {f.category} <span className="badge">{f.deterministic ? "proven by rule" : "heuristic"}</span>
        <div>{f.explanation}</div><small>Evidence: {f.evidence_event_ids.join(", ")} · Suggested: {f.recommended_action}</small></div>)}
      {a.data.localization.resolved ? <p>Origin: {a.data.localization.origin_event_id ?? "undetermined"} · First detectable: {a.data.localization.first_detectable_event_id} · Observed: {a.data.localization.observed_event_id}{a.data.localization.note && <> — <i>{a.data.localization.note}</i></>}</p> : <p>Localization unresolved: {a.data.localization.note}</p>}
      <p><i>AI-assisted diagnosis is not enabled; nothing here is an AI hypothesis.</i></p>
      <button className="primary" onClick={recover}>Run safe recovery simulation</button> <span role="status">{rec}</span></div>}
    {t.data && <div className="card scroll"><h3>Timeline</h3><table><thead><tr><th>#</th><th>Type</th><th>Tool</th><th>Status</th><th>Input / output (redacted)</th></tr></thead><tbody>
      {t.data.events.map((e) => <tr key={e.event_id} className={hit.has(e.event_id) ? "hit" : ""}><td>{e.step_index}</td><td>{e.event_type}</td><td>{e.tool_name}</td><td>{e.status}{e.error_type && ` (${e.error_type})`}</td>
        <td><pre>{JSON.stringify({ in: e.tool_input, out: e.tool_output })}</pre></td></tr>)}</tbody></table><small>Highlighted rows are failure evidence.</small></div>}
  </>);
}
export default function Traces() {
  const [agent, setAgent] = useState(""); const [sel, setSel] = useState<string | null>(null);
  const ag = useApi<{ items: string[] }>("/api/v1/agents");
  const l = useApi<{ total: number; items: { trace_id: string; agent_name: string; created_at: string }[] }>(`/api/v1/traces?limit=50${agent ? `&agent=${encodeURIComponent(agent)}` : ""}`);
  if (sel) return <Detail id={sel} back={() => setSel(null)} />;
  return (<><h2>Trace Explorer</h2>
    <label className="row">Agent <select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All</option>{ag.data?.items.map((a) => <option key={a}>{a}</option>)}</select></label>
    <State loading={l.loading} error={l.error} />
    {l.data && (l.data.items.length === 0 ? <p className="empty">No traces match.</p> : <div className="card scroll"><table><thead><tr><th>Trace</th><th>Agent</th><th>Created</th></tr></thead><tbody>
      {l.data.items.map((t) => <tr key={t.trace_id}><td><button onClick={() => setSel(t.trace_id)}>{t.trace_id}</button></td><td>{t.agent_name}</td><td>{new Date(t.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>)}</>);
}
