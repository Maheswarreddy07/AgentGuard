import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { benchmarkApi, catLabel, download, paths, useApi, useAuth, useMeta } from "../api";
import BenchmarkComparison from "../components/BenchmarkComparison";
import BenchExtras from "../components/BenchExtras";
import { BAD, Caption, Card, Chip, GOOD, Info, Kpi, MUTED, State, chartTip, pct } from "../ui";
import { useT } from "../hooks/context";

const human = (s) => s.replace(/_/g, " ");
const heat = (v) => (v == null ? "transparent" : `rgba(${v >= 0.9 ? "61,220,151" : v >= 0.7 ? "255,209,102" : "255,93,115"},.25)`);

export default function Bench({ params = {} }) {
  const txt = useT("bench");
  const meta = useMeta(), { allowed } = useAuth();
  const sc = useApi(paths.scenarios()), hist = useApi(paths.benchmarks);
  const [split, setSplit] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [run, setRun] = useState(null);           // {id, m, results, mistakes}
  const [phase, setPhase] = useState("idle");      // idle | running | error
  const [err, setErr] = useState(null);
  const [cmp, setCmp] = useState(null), [cmpId, setCmpId] = useState("");

  const groups = {};
  (sc.data?.items ?? []).forEach((s) => { groups[s.category] = (groups[s.category] ?? 0) + 1; });
  const toggle = (c) => setPicked((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  async function load(id) {
    const g = await benchmarkApi.get(id);
    const [all, mis] = await Promise.all([benchmarkApi.results(id), benchmarkApi.results(id, "mistakes")]);
    setRun({ id, m: g.metrics, results: all.results, mistakes: mis.results }); setCmp(null); setCmpId("");
  }
  async function start() {
    setPhase("running"); setErr(null);
    try {
      const ids = picked.size ? sc.data.items.filter((s) => picked.has(s.category)).map((s) => s.id) : undefined;
      const { run_id } = await benchmarkApi.run(ids, split);
      for (let i = 0; i < 120; i++) {   // poll until the backend reports a terminal state
        const g = await benchmarkApi.get(run_id);
        if (g.status === "completed") { await load(run_id); hist.reload(); setPhase("idle"); return; }
        if (g.status === "failed") throw new Error(g.error ?? txt("run_failed"));
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error(txt("run_timeout"));
    } catch (e) { setErr(e.message); setPhase("error"); }
  }
  useEffect(() => { if (!cmpId || !run) { setCmp(null); return; } benchmarkApi.compare(cmpId, run.id).then(setCmp).catch((e) => setErr(e.message)); }, [cmpId, run]);

  useEffect(() => { if (params.run) load(params.run).catch((e) => setErr(e.message)); }, [params.run]); // eslint-disable-line

  const m = run?.m;
  const outcome = m && [{ n: txt("m_safe"), base: m.outcomes.baseline_safe_outcome, prot: m.outcomes.protected_safe_outcome }, { n: txt("m_task"), base: m.outcomes.baseline_task_success, prot: m.outcomes.protected_task_success }];
  const perCat = m && Object.entries(m.per_scenario_category).map(([k, v]) => ({ n: human(k), base: v.baseline_safe, prot: v.protected_safe }));
  const ci = m?.outcomes.safe_outcome_improvement_ci95;
  const GOODHIGH = { precision: 1, recall: 1, localization: 1, task_success: 1, safe_outcome: 1, recovery_success: 1 };

  return (
    <div className="stack">
      <div className="callout wide">⚠ <b>{txt("read_this_first")}</b> {txt("every_number_here_comes_from")} <b>{txt("synthetic_simulated")}</b> {txt("scenarios_that_the_same_author")}</div>
      <Card title={txt("1_choose_what_to_test")} hint={txt("leave_everything_unselected_to_run")}>
        <div className="chips">{Object.entries(groups).map(([c, n]) => <Chip key={c} active={picked.has(c)} onClick={() => toggle(c)}>{human(c)} ({n})</Chip>)}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field inline">{txt("test_set")}<select value={split} onChange={(e) => setSplit(e.target.value)}><option value="">{txt("all_scenarios")}</option><option value="dev">{txt("development_set")}</option><option value="validation">{txt("validation_set")}</option><option value="test">{txt("held_out_test_set")}</option></select></label>
          <button className="btn primary" disabled={phase === "running" || sc.loading || !allowed("run_benchmark")} title={allowed("run_benchmark") ? "" : txt("members_and_admins_can_run")} onClick={start}>{phase === "running" ? txt("running") : txt("run_v1_scenarios", { v1: picked.size ? "selected" : "all" })}</button>
          {hist.data?.items?.filter((r) => r.status === "completed").length > 0 && (
            <label className="field inline">{txt("or_open_a_past_run")}<select value="" onChange={(e) => e.target.value && load(e.target.value)}><option value="">{txt("choose")}</option>
              {hist.data.items.filter((r) => r.status === "completed").map((r) => <option key={r.run_id} value={r.run_id}>{new Date(r.created_at).toLocaleString()} {txt("n_scenarios_scenarios", { n_scenarios: r.n_scenarios })}</option>)}</select></label>)}
        </div>
        {!allowed("run_benchmark") && <p className="muted small">{txt("you_can_browse_past_runs")}</p>}
        {phase === "running" && <div className="progress" role="status" aria-label={txt("running_benchmark")}><i /></div>}
        {(err || sc.error) && <p role="alert" className="alert">{err ?? txt("couldn_t_load_scenarios_error", { error: sc.error })}</p>}
      </Card>

      {!m && phase !== "running" && <p className="muted">{txt("results_will_appear_here")}</p>}
      {m && (<>
        <Card className="verdict">
          <div className="verdict-t">{txt("safe_outcomes_rose_from")} <b style={{ color: BAD }}>{pct(m.outcomes.baseline_safe_outcome, 0)}</b> {txt("to")} <b style={{ color: GOOD }}>{pct(m.outcomes.protected_safe_outcome, 0)}</b> {txt("across_n_scenarios_scenarios", { n_scenarios: m.n_scenarios })}</div>
          <div className="muted">{txt("improvement_95_confidence_interval")} {ci ? txt("v1_to_v2_percentage_points", { v1: (ci[0] * 100).toFixed(1), v2: (ci[1] * 100).toFixed(1) }) : txt("n_a")} {txt("safe_succeeded_recovered_or_stopped")}</div>
        </Card>

        <div className="grid-2">
          <Card title={txt("with_vs_without_agentguard")} hint={txt("safe_outcome_includes_being_stopped")}>
            <BenchmarkComparison rows={outcome.map((o) => ({ label: o.n, without: o.base, with: o.prot }))} caption={txt("taller_green_bars_than_red")} />
          </Card>
          <div className="kpis small">
            <Kpi label={txt("real_failures_caught")} value={pct(m.detection.micro_recall, 0)} hint={meta.metrics.recall?.plain} tone={GOOD} />
            <Kpi label={txt("flags_that_were_right")} value={pct(m.detection.micro_precision, 0)} hint={meta.metrics.precision?.plain} tone={GOOD} />
            <Kpi label={txt("false_alarms_on_good_runs")} value={pct(m.detection.false_positive_rate, 1)} hint={meta.metrics.false_positive_rate?.plain} tone={BAD} />
            <Kpi label={txt("right_step_pinpointed")} value={pct(m.localization.accuracy, 0)} hint={meta.metrics.localization?.plain} />
            <Kpi label={txt("auto_recovery_worked")} value={pct(m.recovery.recovery_success_rate, 0)} sub={txt("n_attempted_attempts", { n_attempted: m.recovery.n_attempted })} hint={meta.metrics.recovery_success?.plain} />
            <Kpi label={txt("added_delay")} value={m.latency_ms.mean_added.toFixed(2) + " ms"} hint={meta.metrics.latency?.plain} />
          </div>
        </div>

        <Card title={txt("results_by_kind_of_scenario")} hint={txt("how_safe_the_outcome_was")}>
          <BenchmarkComparison layout="bars" rows={perCat.map((o) => ({ label: o.n, without: o.base, with: o.prot }))} caption={txt("each_pair_is_one_kind")} />
        </Card>

        <Card title={txt("detection_quality_by_failure_type")} hint={txt("green_90_yellow_70_red")}>
          <div className="scroll"><table className="tbl"><thead><tr><th>{txt("failure_type")}</th><th>{txt("precision")} <Info text={meta.metrics.precision?.plain} /></th><th>{txt("recall")} <Info text={meta.metrics.recall?.plain} /></th><th>{txt("f1")}</th><th>{txt("cases")}</th></tr></thead><tbody>
            {Object.entries(m.per_category).map(([k, v]) => <tr key={k}><td>{catLabel(meta, k)}</td>{[v.precision, v.recall, v.f1].map((x, i) => <td key={i} style={{ background: heat(x) }}>{pct(x, 0)}</td>)}<td>{v.support}</td></tr>)}</tbody></table></div>
        </Card>

        <BenchExtras m={m} />
        <Card title={txt("where_agentguard_was_wrong_length", { length: run.mistakes.length })} hint={txt("scenarios_where_what_was_detected")}>
          {run.mistakes.length === 0 ? <p className="muted">{txt("no_mistakes_in_this_run")}</p> : <ul className="mist">{run.mistakes.map((r) => {
            const missed = r.true.filter((x) => !r.pred.includes(x)), extra = r.pred.filter((x) => !r.true.includes(x));
            return <li key={r.id}><b className="mono">{r.id}</b>{missed.map((x) => <span key={x} className="tag miss">{txt("missed")} {catLabel(meta, x)}</span>)}{extra.map((x) => <span key={x} className="tag fa">{txt("false_alarm")} {catLabel(meta, x)}</span>)}</li>;
          })}</ul>}
        </Card>

        <Card title={txt("compare_with_another_run")} hint={txt("see_how_metrics_changed_between")}>
          <label className="field inline">{txt("compare_against")}<select value={cmpId} onChange={(e) => setCmpId(e.target.value)}><option value="">{txt("choose_a_past_run")}</option>
            {hist.data?.items?.filter((r) => r.status === "completed" && r.run_id !== run.id).map((r) => <option key={r.run_id} value={r.run_id}>{new Date(r.created_at).toLocaleString()} {txt("n_scenarios_scenarios", { n_scenarios: r.n_scenarios })}</option>)}</select></label>
          {cmp && <table className="tbl"><thead><tr><th>{txt("metric")}</th><th>{txt("other_run")}</th><th>{txt("this_run")}</th><th>{txt("change")}</th></tr></thead><tbody>{cmp.rows.map((r) => {
            const better = r.delta == null ? null : (GOODHIGH[r.metric] ? r.delta > 0 : r.delta < 0);
            return <tr key={r.metric}><td>{meta.metrics[r.metric]?.label ?? human(r.metric)}</td><td>{r.metric === "latency" ? r.a?.toFixed(3) + " ms" : pct(r.a)}</td><td>{r.metric === "latency" ? r.b?.toFixed(3) + " ms" : pct(r.b)}</td>
              <td style={{ color: better == null || r.delta === 0 ? MUTED : better ? GOOD : BAD }}>{r.delta == null ? txt("n_a") : r.delta === 0 ? txt("no_change") : (r.delta > 0 ? "▲ " : "▼ ") + (r.metric === "latency" ? Math.abs(r.delta).toFixed(3) + " ms" : Math.abs(r.delta * 100).toFixed(1) + " pts")}</td></tr>; })}</tbody></table>}
        </Card>

        <div className="row">
          <button className="btn" onClick={() => download(`agentguard-${run.id}.json`, JSON.stringify({ metrics: m, results: run.results }, null, 1), "application/json")}>{txt("export_json")}</button>
          <button className="btn" onClick={() => download(`agentguard-${run.id}.csv`, "id,category,true,pred,action,baseline_success,protected_success\n" + run.results.map((r) => [r.id, r.category, r.true.join("|"), r.pred.join("|"), r.action, r.baseline_success, r.protected_success].join(",")).join("\n"), "text/csv")}>{txt("export_csv")}</button>
        </div>
      </>)}
    </div>
  );
}
