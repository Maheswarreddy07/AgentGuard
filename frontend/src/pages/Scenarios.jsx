import { useState } from "react";
import { State, api, useApi } from "../api";
const TEMPLATE = JSON.stringify({ id: "my-scenario-001", category: "custom", description: "[SYNTHETIC] example", task: "Do a thing", events: [{ event_id: "e0", step_index: 0, event_type: "run_start" }, { event_id: "e1", step_index: 1, event_type: "run_end", metadata: { claimed_success: true } }], labels: { failure_categories: [], earliest_detectable_step: null, expected_action: "none" } }, null, 1);
export default function Scenarios() {
    const { data, error, loading, reload } = useApi("/api/v1/scenarios");
    const [text, setText] = useState(TEMPLATE);
    const [msg, setMsg] = useState(null);
    const [q, setQ] = useState("");
    async function add() { try {
        await api("/api/v1/scenarios", { method: "POST", body: text });
        setMsg("Added.");
        reload();
    }
    catch (e) {
        setMsg("Rejected: " + e.message);
    } }
    const rows = data?.items.filter((s) => (s.id + s.category).includes(q)) ?? [];
    return (<><h2>Scenarios</h2><State loading={loading} error={error}/>
    <label className="row">Filter <input value={q} onChange={(e) => setQ(e.target.value)}/></label>
    {data && <div className="card scroll"><table><thead><tr><th>ID</th><th>Category</th><th>Events</th><th>Labelled failures</th></tr></thead><tbody>{rows.map((s) => <tr key={s.id}><td>{s.id}</td><td>{s.category}</td><td>{s.n_events}</td><td>{s.labels.failure_categories.join(", ") || "—"}</td></tr>)}</tbody></table></div>}
    <div className="card"><h3>Add scenario (validated by the backend)</h3><label htmlFor="sj">Scenario JSON</label><textarea id="sj" value={text} onChange={(e) => setText(e.target.value)}/>
      <div className="row"><button className="primary" onClick={add}>Validate and add</button><span role="status">{msg}</span></div></div></>);
}
