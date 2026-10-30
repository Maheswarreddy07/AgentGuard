import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, catLabel, download, useApi, useAuth, useMeta } from "../api";
import { BAD, Caption, Card, Chip, GOOD, Info, Kpi, MUTED, State, chartTip, pct } from "../ui";

const human = (s) => s.replace(/_/g, " ");
const heat = (v) => (v == null ? "transparent" : `rgba(${v >= 0.9 ? "61,220,151" : v >= 0.7 ? "255,209,102" : "255,93,115"},.25)`);

export default function Bench({ params = {} }) {
  const meta = useMeta(), { can } = useAuth();
  const sc = useApi("/api/v1/scenarios"), hist = useApi("/api/v1/benchmarks");
  const [picked, setPicked] = useState(new Set());
  const [run, setRun] = useState(null);           // {id, m, results, mistakes}
  const [phase, setPhase] = useState("idle");      // idle | running | error
  const [err, setErr] = useState(null);
  const [cmp, setCmp] = useState(null), [cmpId, setCmpId] = useState("");

  const groups = {};
  (sc.data?.items ?? []).forEach((s) => { groups[s.category] = (groups[s.category] ?? 0) + 1; });
  const toggle = (c) => setPicked((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  async function load(id) {
    const g = await api(`/api/v1/benchmarks/${id}`);
    const [all, mis] = await Promise.all([api(`/api/v1/benchmarks/${id}/results`), api(`/api/v1/benchmarks/${id}/results?only=mistakes`)]);
    setRun({ id, m: g.metrics, results: all.results, mistakes: mis.results }); setCmp(null); setCmpId("");
  }
  async function start() {
    setPhase("running"); setErr(null);
    try {
      const ids = picked.size ? sc.data.items.filter((s) => picked.has(s.category)).map((s) => s.id) : undefined;
      const { run_id } = await api("/api/v1/benchmarks/run", { method: "POST", body: JSON.stringify({ scenario_ids: ids }) });
      for (let i = 0; i < 120; i++) {   // poll until the backend reports a terminal state
        const g = await api(`/api/v1/benchmarks/${run_id}`);
        if (g.status === "completed") { await load(run_id); hist.reload(); setPhase("idle"); return; }
        if (g.status === "failed") throw new Error(g.error ?? "The run failed");
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error("Timed out waiting for the run");
    } catch (e) { setErr(e.message); setPhase("error"); }
  }
  useEffect(() => { if (!cmpId || !run) { setCmp(null); return; } api(`/api/v1/benchmark-compare?a=${cmpId}&b=${run.id}`).then(setCmp).catch((e) => setErr(e.message)); }, [cmpId, run]);

  useEffect(() => { if (params.run) load(params.run).catch((e) => setErr(e.message)); }, [params.run]); // eslint-disable-line

  const m = run?.m;
  const outcome = m && [{ n: "Safe outcome", base: m.outcomes.baseline_safe_outcome, prot: m.outcomes.protected_safe_outcome }, { n: "Task success", base: m.outcomes.baseline_task_success, prot: m.outcomes.protected_task_success }];
  const perCat = m && Object.entries(m.per_scenario_category).map(([k, v]) => ({ n: human(k), base: v.baseline_safe, prot: v.protected_safe }));
  const ci = m?.outcomes.safe_outcome_improvement_ci95;
  const GOODHIGH = { precision: 1, recall: 1, localization: 1, task_success: 1, safe_outcome: 1, recovery_success: 1 };

  return (
    <div className="stack">
      <div className="callout wide">⚠ <b>Read this first.</b> Every number here comes from <b>synthetic, simulated</b> scenarios that the same author wrote as the detectors, and “without AgentGuard” outcomes are defined by the scenarios. It shows the system works as designed, not how it performs on real agents.</div>
      <Card title="1 · Choose what to test" hint="Leave everything unselected to run all scenarios.">
        <div className="chips">{Object.entries(groups).map(([c, n]) => <Chip key={c} active={picked.has(c)} onClick={() => toggle(c)}>{human(c)} ({n})</Chip>)}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={phase === "running" || sc.loading || !can("member")} title={can("member") ? "" : "Members and admins can run benchmarks"} onClick={start}>{phase === "running" ? "Running…" : `Run ${picked.size ? "selected" : "all"} scenarios`}</button>
          {hist.data?.items?.filter((r) => r.status === "completed").length > 0 && (
            <label className="field inline">Or open a past run<select value="" onChange={(e) => e.target.value && load(e.target.value)}><option value="">Choose…</option>
              {hist.data.items.filter((r) => r.status === "completed").map((r) => <option key={r.run_id} value={r.run_id}>{new Date(r.created_at).toLocaleString()} · {r.n_scenarios} scenarios</option>)}</select></label>)}
        </div>
        {!can("member") && <p className="muted small">You can browse past runs below, but only members and admins can start new ones.</p>}
        {phase === "running" && <div className="progress" role="status" aria-label="Running benchmark"><i /></div>}
        {(err || sc.error) && <p role="alert" className="alert">{err ?? `Couldn’t load scenarios: ${sc.error}`}</p>}
      </Card>

      {!m && phase !== "running" && <p className="muted">Results will appear here.</p>}
      {m && (<>
        <Card className="verdict">
          <div className="verdict-t">Safe outcomes rose from <b style={{ color: BAD }}>{pct(m.outcomes.baseline_safe_outcome, 0)}</b> to <b style={{ color: GOOD }}>{pct(m.outcomes.protected_safe_outcome, 0)}</b> across {m.n_scenarios} scenarios</div>
          <div className="muted">Improvement 95% confidence interval: {ci ? `${(ci[0] * 100).toFixed(1)} to ${(ci[1] * 100).toFixed(1)} percentage points` : "n/a"} · “Safe” = succeeded, recovered, or stopped before harm</div>
        </Card>

        <div className="grid-2">
          <Card title="With vs without AgentGuard" hint="Safe outcome includes being stopped before harm. Task success counts only runs that finished correctly.">
            <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={outcome}><CartesianGrid vertical={false} stroke="#2a3140" /><XAxis dataKey="n" stroke={MUTED} fontSize={12} /><YAxis domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} width={42} />
              <Tooltip {...chartTip} formatter={(v) => pct(v)} /><Legend /><Bar dataKey="base" name="Without AgentGuard" fill={BAD} radius={[6, 6, 0, 0]}><LabelList dataKey="base" position="top" formatter={(v) => pct(v, 0)} fill="#e8eaf0" fontSize={12} /></Bar><Bar dataKey="prot" name="With AgentGuard" fill={GOOD} radius={[6, 6, 0, 0]}><LabelList dataKey="prot" position="top" formatter={(v) => pct(v, 0)} fill="#e8eaf0" fontSize={12} /></Bar></BarChart></ResponsiveContainer></div>
            <Caption>Taller green bars than red bars mean AgentGuard made outcomes better. “Safe” includes runs stopped before they could do harm.</Caption>
          </Card>
          <div className="kpis small">
            <Kpi label="Real failures caught" value={pct(m.detection.micro_recall, 0)} hint={meta.metrics.recall?.plain} tone={GOOD} />
            <Kpi label="Flags that were right" value={pct(m.detection.micro_precision, 0)} hint={meta.metrics.precision?.plain} tone={GOOD} />
            <Kpi label="False alarms on good runs" value={pct(m.detection.false_positive_rate, 1)} hint={meta.metrics.false_positive_rate?.plain} tone={BAD} />
            <Kpi label="Right step pinpointed" value={pct(m.localization.accuracy, 0)} hint={meta.metrics.localization?.plain} />
            <Kpi label="Auto-recovery worked" value={pct(m.recovery.recovery_success_rate, 0)} sub={`${m.recovery.n_attempted} attempts`} hint={meta.metrics.recovery_success?.plain} />
            <Kpi label="Added delay" value={m.latency_ms.mean_added.toFixed(2) + " ms"} hint={meta.metrics.latency?.plain} />
          </div>
        </div>

        <Card title="Results by kind of scenario" hint="How safe the outcome was for each family of test case, with and without AgentGuard.">
          <div style={{ height: 30 * perCat.length + 60 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={perCat} layout="vertical" margin={{ left: 8, right: 20 }}><CartesianGrid horizontal={false} stroke="#2a3140" /><XAxis type="number" domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} />
            <YAxis type="category" dataKey="n" width={130} interval={0} stroke={MUTED} fontSize={12} /><Tooltip {...chartTip} formatter={(v) => pct(v, 0)} /><Legend /><Bar dataKey="base" name="Without" fill={BAD} radius={[0, 4, 4, 0]} /><Bar dataKey="prot" name="With" fill={GOOD} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
          <Caption>Each pair is one kind of test case. Where green is not longer than red, AgentGuard did not help for that kind.</Caption>
        </Card>

        <Card title="Detection quality by failure type" hint="Green ≥ 90%, yellow ≥ 70%, red below. Support = how many scenarios truly had this failure.">
          <div className="scroll"><table className="tbl"><thead><tr><th>Failure type</th><th>Precision <Info text={meta.metrics.precision?.plain} /></th><th>Recall <Info text={meta.metrics.recall?.plain} /></th><th>F1</th><th>Cases</th></tr></thead><tbody>
            {Object.entries(m.per_category).map(([k, v]) => <tr key={k}><td>{catLabel(meta, k)}</td>{[v.precision, v.recall, v.f1].map((x, i) => <td key={i} style={{ background: heat(x) }}>{pct(x, 0)}</td>)}<td>{v.support}</td></tr>)}</tbody></table></div>
        </Card>

        <Card title={`Where AgentGuard was wrong (${run.mistakes.length})`} hint="Scenarios where what was detected differs from the ground truth.">
          {run.mistakes.length === 0 ? <p className="muted">No mistakes in this run.</p> : <ul className="mist">{run.mistakes.map((r) => {
            const missed = r.true.filter((x) => !r.pred.includes(x)), extra = r.pred.filter((x) => !r.true.includes(x));
            return <li key={r.id}><b className="mono">{r.id}</b>{missed.map((x) => <span key={x} className="tag miss">Missed: {catLabel(meta, x)}</span>)}{extra.map((x) => <span key={x} className="tag fa">False alarm: {catLabel(meta, x)}</span>)}</li>;
          })}</ul>}
        </Card>

        <Card title="Compare with another run" hint="See how metrics changed between two runs.">
          <label className="field inline">Compare against<select value={cmpId} onChange={(e) => setCmpId(e.target.value)}><option value="">Choose a past run…</option>
            {hist.data?.items?.filter((r) => r.status === "completed" && r.run_id !== run.id).map((r) => <option key={r.run_id} value={r.run_id}>{new Date(r.created_at).toLocaleString()} · {r.n_scenarios} scenarios</option>)}</select></label>
          {cmp && <table className="tbl"><thead><tr><th>Metric</th><th>Other run</th><th>This run</th><th>Change</th></tr></thead><tbody>{cmp.rows.map((r) => {
            const better = r.delta == null ? null : (GOODHIGH[r.metric] ? r.delta > 0 : r.delta < 0);
            return <tr key={r.metric}><td>{meta.metrics[r.metric]?.label ?? human(r.metric)}</td><td>{r.metric === "latency" ? r.a?.toFixed(3) + " ms" : pct(r.a)}</td><td>{r.metric === "latency" ? r.b?.toFixed(3) + " ms" : pct(r.b)}</td>
              <td style={{ color: better == null || r.delta === 0 ? MUTED : better ? GOOD : BAD }}>{r.delta == null ? "n/a" : r.delta === 0 ? "no change" : (r.delta > 0 ? "▲ " : "▼ ") + (r.metric === "latency" ? Math.abs(r.delta).toFixed(3) + " ms" : Math.abs(r.delta * 100).toFixed(1) + " pts")}</td></tr>; })}</tbody></table>}
        </Card>

        <div className="row">
          <button className="btn" onClick={() => download(`agentguard-${run.id}.json`, JSON.stringify({ metrics: m, results: run.results }, null, 1), "application/json")}>Export JSON</button>
          <button className="btn" onClick={() => download(`agentguard-${run.id}.csv`, "id,category,true,pred,action,baseline_success,protected_success\n" + run.results.map((r) => [r.id, r.category, r.true.join("|"), r.pred.join("|"), r.action, r.baseline_success, r.protected_success].join(",")).join("\n"), "text/csv")}>Export CSV</button>
        </div>
      </>)}
    </div>
  );
}
