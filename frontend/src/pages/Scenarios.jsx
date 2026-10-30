import { useState } from "react";
import { api, catLabel, useApi, useMeta } from "../api";
import Flow from "../components/Flow";
import { Card, Chip, Empty, State } from "../ui";
const TEMPLATE = JSON.stringify({ id: "my-scenario-001", category: "custom", description: "[SYNTHETIC] example", task: "Do a thing", events: [{ event_id: "e0", step_index: 0, event_type: "run_start" }, { event_id: "e1", step_index: 1, event_type: "run_end", metadata: { claimed_success: true } }], labels: { failure_categories: [], earliest_detectable_step: null, expected_action: "none" } }, null, 1);
const human = (s) => s.replace(/_/g, " ");

function Detail({ id, onClose }) {
  const meta = useMeta(), d = useApi(`/api/v1/scenarios/${id}`);
  if (!d.data) return <State loading={d.loading} error={d.error} h={160} />;
  const s = d.data, step = s.labels.earliest_detectable_step, mk = step != null && s.events[step] ? { [s.events[step].event_id]: ["First detectable"] } : {};
  return (
    <Card title={s.id} right={<button className="btn" onClick={onClose}>Close</button>}>
      <p>{s.description}</p>
      <Flow events={s.events} markers={mk} />
      <div className="cols">
        <div><h4>Ground truth (hidden from detectors)</h4><p>{s.labels.failure_categories.length ? s.labels.failure_categories.map((c) => <span key={c} className="tag">{catLabel(meta, c)}</span>) : "No failure — AgentGuard should stay quiet."}</p>
          <p className="muted">Expected response: <b>{meta.actions?.[s.labels.expected_action]?.label ?? s.labels.expected_action}</b></p></div>
        <div><h4>Simulated environment</h4><pre>{JSON.stringify(s.sim, null, 1)}</pre></div>
      </div>
    </Card>
  );
}

export default function Scenarios() {
  const { data, error, loading, reload } = useApi("/api/v1/scenarios");
  const [cat, setCat] = useState(""), [q, setQ] = useState(""), [open, setOpen] = useState(null);
  const [text, setText] = useState(TEMPLATE), [msg, setMsg] = useState(null);
  async function add() { try { await api("/api/v1/scenarios", { method: "POST", body: text }); setMsg({ ok: true, t: "Added." }); reload(); } catch (e) { setMsg({ ok: false, t: "Rejected: " + e.message }); } }
  if (!data) return <State loading={loading} error={error} h={200} />;
  const cats = [...new Set(data.items.map((s) => s.category))];
  const rows = data.items.filter((s) => (!cat || s.category === cat) && (s.id + s.description).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <Card title={`${data.items.length} test scenarios`} hint="Each scenario is a scripted agent run with a known right answer. The benchmark checks whether AgentGuard agrees.">
        <label className="field">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="id or description" /></label>
        <div className="chips"><Chip active={!cat} onClick={() => setCat("")}>All</Chip>{cats.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{human(c)}</Chip>)}</div>
      </Card>
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
      {rows.length === 0 ? <Empty title="No scenarios match" /> : <div className="scn-grid">{rows.map((s) => (
        <button key={s.id} className={"scn" + (open === s.id ? " on" : "")} onClick={() => setOpen(s.id)}>
          <b className="mono">{s.id}</b><span className="muted">{s.description.replace("[SYNTHETIC] ", "").replace("[SYNTHETIC, adversarial] ", "")}</span>
          <span className="scn-f">{s.labels.failure_categories.length === 0 ? <span className="tag ok">should stay quiet</span> : <span className="tag">{s.labels.failure_categories.length} failure type(s)</span>}<span className="muted">{s.n_events} steps</span></span></button>))}</div>}
      <Card title="Add your own scenario" hint="Paste a scenario as JSON. The backend validates it before saving."><label htmlFor="sj" className="muted">Scenario JSON</label><textarea id="sj" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row"><button className="btn primary" onClick={add}>Validate and add</button>{msg && <span role="status" className={msg.ok ? "okt" : "errt"}>{msg.t}</span>}</div></Card>
    </div>
  );
}
