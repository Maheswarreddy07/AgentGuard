import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { catLabel, paths, useApi, useMeta } from "../api";
import { go } from "../router";
import BenchmarkComparison from "../components/BenchmarkComparison";
import HealthSummary from "../components/HealthSummary";
import { ACCENT, BAD, Caption, Card, Kpi, MUTED, SevBadge, State, chartTip, pct, sevColor, timeAgo } from "../ui";
import { useT } from "../hooks/context";

export default function OverviewFull() {
  const txt = useT("overview_full");
  const meta = useMeta(), ov = useApi(paths.overview()), tr = useApi(paths.trends);
  if (!ov.data) return <State loading={ov.loading} error={ov.error} h={300} onRetry={ov.reload} />;
  const { live, benchmark: bm } = ov.data;
  const cats = Object.entries(live.category_stats).map(([key, v]) => ({ key, label: catLabel(meta, key), count: v.count, sev: v.max_severity })).sort((a, b) => b.count - a.count);
  return (
    <div className="stack">
      <HealthSummary live={live} severities={meta.severities} onNavigate={go} />

      <Card title={txt("operations")} sub={txt("what_agentguard_has_been_doing")}>
        <div className="kpis">
          <Kpi label={txt("waiting_for_approval")} value={live.pending_approvals} tone={live.pending_approvals ? sevColor("high") : undefined} onClick={() => go("/approvals")} hint={txt("actions_an_agent_is_not")} />
          <Kpi label={txt("actions_blocked")} value={live.blocked_actions} sub={txt("blocked_runs_runv2_stopped", { blocked_runs: live.blocked_runs, v2: live.blocked_runs === 1 ? "" : "s" })} onClick={() => go("/policies")} hint={txt("tool_calls_a_safety_rule")} />
          <Kpi label={txt("runs_at_risk")} value={live.risky_runs} sub={txt("average_risk_v1", { v1: live.avg_risk == null ? "n/a" : live.avg_risk.toFixed(0) })} tone={live.risky_runs ? sevColor("medium") : undefined} onClick={() => go("/risk")} hint={txt("runs_whose_risk_score_reached")} />
          <Kpi label={txt("succeeded_failed")} value={`${live.successful_runs} / ${live.failed_runs}`} sub={txt("running_runs_still_running", { running_runs: live.running_runs })} />
          <Kpi label={txt("recoveries_tried")} value={live.recovery_attempts} />
          <Kpi label={txt("average_run_time")} value={live.avg_duration_ms == null ? "n/a" : (live.avg_duration_ms / 1000).toFixed(1) + " s"} />
          <Kpi label={txt("estimated_cost")} value={"$" + live.total_cost_usd.toFixed(2)} sub={txt("from_model_usage_that_agents")} />
        </div>
      </Card>

      <Card title={txt("what_is_going_wrong")} sub={txt("number_of_runs_affected_by")} right={<div className="sev-legend">{[...meta.severities].reverse().map((s) => <span key={s}><i style={{ background: sevColor(s) }} />{s}</span>)}</div>}>
        <div style={{ height: 40 * cats.length + 30 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cats} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid horizontal={false} stroke="var(--line)" />
              <XAxis type="number" allowDecimals={false} stroke={MUTED} fontSize={12} />
              <YAxis type="category" dataKey="label" width={190} interval={0} stroke={MUTED} fontSize={12} />
              <Tooltip {...chartTip} formatter={(v) => [txt("tip_runs", { n: v }), txt("tip_affected")]} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => go("/traces", { category: d?.payload?.key ?? d?.key })}>
                {cats.map((c) => <Cell key={c.key} fill={sevColor(c.sev)} />)}<LabelList dataKey="count" position="right" fill="var(--fg)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Caption>{txt("each_bar_is_one_kind")}</Caption>
      </Card>

      <div className="grid-2">
        <Card title={txt("runs_by_severity")} sub={txt("each_run_counted_once_at")}>
          <div className="sev-row">{[...meta.severities].reverse().map((s) => <button key={s} className="sev-tile" style={{ "--c": sevColor(s) }} onClick={() => go("/traces", { severity: s })}><b>{live.by_severity[s] ?? 0}</b><span>{s}</span></button>)}</div>
          <Caption>{txt("click_a_tile_to_see")}</Caption>
        </Card>
        <Card title={txt("runs_over_time")} sub={txt("per_day_runs_received_and")}>
          {tr.data?.items?.length ? (<>
            <div style={{ height: 160 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={tr.data.items}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="date" stroke={MUTED} fontSize={11} /><YAxis allowDecimals={false} stroke={MUTED} fontSize={11} width={28} /><Tooltip {...chartTip} /><Legend />
              <Area dataKey="runs" name="Runs received" stroke={ACCENT} fill={ACCENT} fillOpacity={0.2} /><Area dataKey="with_findings" name="Runs flagged" stroke={BAD} fill={BAD} fillOpacity={0.25} /></AreaChart></ResponsiveContainer></div>
            <Caption>{txt("if_the_red_area_grows")}</Caption></>) : <p className="muted">{txt("not_enough_data_yet")}</p>}
        </Card>
      </div>

      <Card title={txt("recent_urgent_problems")} sub={txt("most_severe_first")} right={<button className="btn" onClick={() => go("/problems")}>{txt("see_all_problems")}</button>}>
        {live.recent_incidents.length === 0 ? <p className="muted">{txt("no_critical_or_high_severity")}</p> : (
          <ul className="incidents">{live.recent_incidents.map((t) => (
            <li key={t.trace_id}><a href={"#/traces/" + t.trace_id} className="incident" style={{ "--c": sevColor(t.max_severity) }}>
              <SevBadge sev={t.max_severity} /><span className="inc-t">{t.headline}</span>
              <span className="muted">{t.categories.map((c) => catLabel(meta, c)).join(" · ")} · {timeAgo(t.created_at)}</span><span className="go">{txt("investigate")}</span></a></li>))}</ul>)}
      </Card>

      <Card title={txt("agentguard_benchmark")} sub={txt("how_much_the_protection_layer")} right={<span className="badge">{txt("synthetic_simulated")}</span>}>
        {!bm ? <p className="muted">{txt("no_benchmark_has_been_run")} <button className="btn" onClick={() => go("/bench")}>{txt("open_benchmark_lab")}</button></p> : (
          <div className="grid-2">
            <BenchmarkComparison rows={[{ label: txt("m_safe"), without: bm.outcomes.baseline_safe_outcome, with: bm.outcomes.protected_safe_outcome }]} height={180} caption={txt("safe_outcome_the_run_succeeded")} />
            <div className="kpis small">
              <Kpi label={txt("catches_real_failures")} value={pct(bm.detection.micro_recall, 0)} hint={meta.metrics.recall?.plain} />
              <Kpi label={txt("flags_are_correct")} value={pct(bm.detection.micro_precision, 0)} hint={meta.metrics.precision?.plain} />
              <Kpi label={txt("recovery_success")} value={pct(bm.recovery.recovery_success_rate, 0)} hint={meta.metrics.recovery_success?.plain} />
              <Kpi label={txt("added_delay")} value={bm.latency_ms.mean_added.toFixed(2) + " ms"} hint={meta.metrics.latency?.plain} />
            </div>
            <p className="muted wide">{txt("results_come_from_synthetic_scenarios")} <button className="linkbtn" onClick={() => go("/bench")}>{txt("details")}</button></p>
          </div>)}
      </Card>
    </div>
  );
}
