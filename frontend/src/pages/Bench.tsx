import { useState } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { State, api, download, pct, useApi } from "../api";
interface Res { id: string; category: string; true: string[]; pred: string[]; action: string; baseline_success: boolean; protected_success: boolean }
interface M { n_scenarios: number; detection: { micro_precision: number | null; micro_recall: number | null; micro_f1: number | null; macro_f1: number | null; false_positive_rate: number | null }; per_category: Record<string, { precision: number | null; recall: number | null; f1: number | null; support: number }>; localization: { accuracy: number | null; mean_abs_step_error: number | null }; outcomes: { baseline_task_success: number; protected_task_success: number; success_improvement_ci95: number[] | null; baseline_safe_outcome: number; protected_safe_outcome: number }; recovery: { recovery_success_rate: number | null; n_attempted: number }; unnecessary_intervention_rate: number | null; latency_ms: { mean_added: number } }
export default function Bench() {
  const sc = useApi<{ items: { id: string; category: string }[] }>("/api/v1/scenarios");
  const [cat, setCat] = useState(""); const [runId, setRunId] = useState<string | null>(null);
  const [m, setM] = useState<M | null>(null); const [res, setRes] = useState<Res[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const cats = Array.from(new Set(sc.data?.items.map((s) => s.category) ?? []));
  async function run() {
    setBusy(true); setErr(null); setM(null);
    try {
      const ids = cat ? sc.data!.items.filter((s) => s.category === cat).map((s) => s.id) : undefined;
      const { run_id } = await api<{ run_id: string }>("/api/v1/benchmarks/run", { method: "POST", body: JSON.stringify({ scenario_ids: ids }) });
      setRunId(run_id);
      for (let i = 0; i < 60; i++) {  // poll until the backend reports a terminal status
        const g = await api<{ status: string; error: string | null; metrics: M | null }>(`/api/v1/benchmarks/${run_id}`);
        if (g.status === "completed") { setM(g.metrics); setRes((await api<{ results: Res[] }>(`/api/v1/benchmarks/${run_id}/results`)).results); break; }
        if (g.status === "failed") throw new Error(g.error ?? "run failed");
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const chart = m ? Object.entries(m.per_category).map(([name, v]) => ({ name, precision: v.precision ?? 0, recall: v.recall ?? 0 })) : [];
  const wrong = res.filter((r) => [...r.true].sort().join() !== [...r.pred].sort().join());
  return (<><h2>Benchmark Lab <span className="badge">synthetic · simulated</span></h2>
    <div className="row"><label>Scenarios <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button className="primary" disabled={busy || sc.loading} onClick={run}>{busy ? "Running…" : "Run baseline vs protected"}</button>
      {m && <><button onClick={() => download(`benchmark-${runId}.json`, JSON.stringify({ metrics: m, results: res }, null, 1), "application/json")}>Export JSON</button>
        <button onClick={() => download(`benchmark-${runId}.csv`, "id,category,true,pred,action,baseline_success,protected_success\n" + res.map((r) => [r.id, r.category, r.true.join("|"), r.pred.join("|"), r.action, r.baseline_success, r.protected_success].join(",")).join("\n"), "text/csv")}>Export CSV</button></>}</div>
    <State loading={sc.loading} error={sc.error || err} />
    {m && <>
      <p><i>Baseline outcomes are by construction of the synthetic scenarios. Scenarios and detectors share an author, so near-perfect detection is expected and does not predict real-agent performance.</i></p>
      <div className="grid">
        <div className="card"><h3>Precision / Recall / F1</h3>{pct(m.detection.micro_precision)} / {pct(m.detection.micro_recall)} / {pct(m.detection.micro_f1)}</div>
        <div className="card"><h3>Macro-F1</h3><div className="big">{pct(m.detection.macro_f1)}</div></div>
        <div className="card"><h3>False-positive rate</h3><div className="big">{pct(m.detection.false_positive_rate)}</div></div>
        <div className="card"><h3>Localization accuracy</h3><div className="big">{pct(m.localization.accuracy)}</div></div>
        <div className="card"><h3>Task success</h3>Baseline {pct(m.outcomes.baseline_task_success)} → Protected {pct(m.outcomes.protected_task_success)}<br /><small>Δ 95% CI {m.outcomes.success_improvement_ci95?.map((x) => (x * 100).toFixed(1)).join(" to ")} pts</small></div>
        <div className="card"><h3>Safe outcome</h3>Baseline {pct(m.outcomes.baseline_safe_outcome)} → Protected {pct(m.outcomes.protected_safe_outcome)}</div>
        <div className="card"><h3>Recovery success</h3>{pct(m.recovery.recovery_success_rate)} (n={m.recovery.n_attempted})</div>
        <div className="card"><h3>Unnecessary interventions</h3>{pct(m.unnecessary_intervention_rate)}</div>
        <div className="card"><h3>Added latency</h3>{m.latency_ms.mean_added.toFixed(3)} ms</div>
      </div>
      <div className="card" style={{ height: 300 }}><h3>Per-category precision and recall</h3><ResponsiveContainer width="100%" height="90%"><BarChart data={chart}><XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={70} /><YAxis domain={[0, 1]} /><Tooltip /><Legend /><Bar dataKey="precision" fill="#6ea8fe" /><Bar dataKey="recall" fill="#51cf66" /></BarChart></ResponsiveContainer></div>
      <div className="card"><h3>False positives / negatives</h3>{wrong.length === 0 ? <p>None in this run.</p> : <ul>{wrong.map((r) => <li key={r.id}>{r.id}: expected [{r.true.join(", ")}] got [{r.pred.join(", ")}]</li>)}</ul>}</div></>}
    {!m && !busy && !err && <p className="empty">Run a benchmark to see results.</p>}</>);
}
