import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { catLabel, demoApi, paths, useApi, useAuth, useMeta } from "../api";
import { go } from "../router";
import BenchmarkComparison from "../components/BenchmarkComparison";
import EmptyState from "../components/EmptyState";
import HealthSummary from "../components/HealthSummary";
import { ACCENT, BAD, Caption, Card, Kpi, MUTED, SevBadge, State, chartTip, pct, sevColor, timeAgo } from "../ui";

function GettingStarted({ onLoaded }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  async function load() { setBusy(true); try { await demoApi.seed(); onLoaded(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <EmptyState icon="👋" title="Welcome — nothing to show yet" action={<>
      <ol className="steps">
        <li><b>Load demo data</b> — synthetic agent runs (some healthy, some broken) so you can explore.</li>
        <li><b>Or connect a real agent</b> in “Connect an agent”; its runs appear here within seconds.</li>
        <li><b>Run the Benchmark Lab</b> to measure how much AgentGuard helps.</li>
      </ol>
      <div className="row"><button className="btn primary" disabled={busy || !can("member")} onClick={load}>{busy ? "Loading…" : "Load demo data"}</button><button className="btn" onClick={() => go("/integrations")}>Connect an agent</button></div>
      {!can("member") && <p className="muted">Ask a member or admin to load demo data.</p>}
      {err && <p role="alert" className="alert">{err}</p>}
    </>} />
  );
}

export default function Overview() {
  const meta = useMeta(), ov = useApi(paths.overview()), tr = useApi(paths.trends);
  if (!ov.data) return <State loading={ov.loading} error={ov.error} h={300} onRetry={ov.reload} />;
  const { live, benchmark: bm } = ov.data;
  if (live.total_runs === 0) return <GettingStarted onLoaded={() => { ov.reload(); tr.reload(); }} />;
  const cats = Object.entries(live.category_stats).map(([key, v]) => ({ key, label: catLabel(meta, key), count: v.count, sev: v.max_severity })).sort((a, b) => b.count - a.count);
  return (
    <div className="stack">
      <HealthSummary live={live} severities={meta.severities} onNavigate={go} />

      <Card title="Operations" sub="What AgentGuard has been doing for your agents">
        <div className="kpis">
          <Kpi label="Waiting for approval" value={live.pending_approvals} tone={live.pending_approvals ? sevColor("high") : undefined} onClick={() => go("/approvals")} hint="Actions an agent is not allowed to take without a person saying yes." />
          <Kpi label="Actions blocked" value={live.blocked_actions} sub={`${live.blocked_runs} run${live.blocked_runs === 1 ? "" : "s"} stopped`} onClick={() => go("/policies")} hint="Tool calls a safety rule stopped before they ran." />
          <Kpi label="Runs at risk" value={live.risky_runs} sub={`average risk ${live.avg_risk == null ? "n/a" : live.avg_risk.toFixed(0)}`} tone={live.risky_runs ? sevColor("medium") : undefined} onClick={() => go("/risk")} hint="Runs whose risk score reached the warning level." />
          <Kpi label="Succeeded / failed" value={`${live.successful_runs} / ${live.failed_runs}`} sub={`${live.running_runs} still running`} />
          <Kpi label="Recoveries tried" value={live.recovery_attempts} />
          <Kpi label="Average run time" value={live.avg_duration_ms == null ? "n/a" : (live.avg_duration_ms / 1000).toFixed(1) + " s"} />
          <Kpi label="Estimated cost" value={"$" + live.total_cost_usd.toFixed(2)} sub="from model usage that agents reported" />
        </div>
      </Card>

      <Card title="What is going wrong" sub="Number of runs affected by each kind of problem" right={<div className="sev-legend">{[...meta.severities].reverse().map((s) => <span key={s}><i style={{ background: sevColor(s) }} />{s}</span>)}</div>}>
        <div style={{ height: 40 * cats.length + 30 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cats} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid horizontal={false} stroke="#2a3140" />
              <XAxis type="number" allowDecimals={false} stroke={MUTED} fontSize={12} />
              <YAxis type="category" dataKey="label" width={190} interval={0} stroke={MUTED} fontSize={12} />
              <Tooltip {...chartTip} formatter={(v) => [v + " runs", "Affected"]} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => go("/traces", { category: d?.payload?.key ?? d?.key })}>
                {cats.map((c) => <Cell key={c.key} fill={sevColor(c.sev)} />)}<LabelList dataKey="count" position="right" fill="#e8eaf0" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Caption>Each bar is one kind of problem. Its colour is the worst severity seen for it (see legend). Click a bar to list the affected runs.</Caption>
      </Card>

      <div className="grid-2">
        <Card title="Runs by severity" sub="Each run counted once, at its worst finding">
          <div className="sev-row">{[...meta.severities].reverse().map((s) => <button key={s} className="sev-tile" style={{ "--c": sevColor(s) }} onClick={() => go("/traces", { severity: s })}><b>{live.by_severity[s] ?? 0}</b><span>{s}</span></button>)}</div>
          <Caption>Click a tile to see just those runs. Start with the most severe.</Caption>
        </Card>
        <Card title="Runs over time" sub="Per day: runs received and runs flagged">
          {tr.data?.items?.length ? (<>
            <div style={{ height: 160 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={tr.data.items}><CartesianGrid stroke="#2a3140" vertical={false} /><XAxis dataKey="date" stroke={MUTED} fontSize={11} /><YAxis allowDecimals={false} stroke={MUTED} fontSize={11} width={28} /><Tooltip {...chartTip} /><Legend />
              <Area dataKey="runs" name="Runs received" stroke={ACCENT} fill={ACCENT} fillOpacity={0.2} /><Area dataKey="with_findings" name="Runs flagged" stroke={BAD} fill={BAD} fillOpacity={0.25} /></AreaChart></ResponsiveContainer></div>
            <Caption>If the red area grows towards the blue one, more of your runs are going wrong.</Caption></>) : <p className="muted">Not enough data yet.</p>}
        </Card>
      </div>

      <Card title="Recent urgent problems" sub="Most severe first" right={<button className="btn" onClick={() => go("/problems")}>See all problems</button>}>
        {live.recent_incidents.length === 0 ? <p className="muted">No critical or high-severity problems. 🎉</p> : (
          <ul className="incidents">{live.recent_incidents.map((t) => (
            <li key={t.trace_id}><a href={"#/traces/" + t.trace_id} className="incident" style={{ "--c": sevColor(t.max_severity) }}>
              <SevBadge sev={t.max_severity} /><span className="inc-t">{t.headline}</span>
              <span className="muted">{t.categories.map((c) => catLabel(meta, c)).join(" · ")} · {timeAgo(t.created_at)}</span><span className="go">Investigate →</span></a></li>))}</ul>)}
      </Card>

      <Card title="AgentGuard benchmark" sub="How much the protection layer helps" right={<span className="badge">synthetic · simulated</span>}>
        {!bm ? <p className="muted">No benchmark has been run yet. <button className="btn" onClick={() => go("/bench")}>Open Benchmark Lab</button></p> : (
          <div className="grid-2">
            <BenchmarkComparison rows={[{ label: "Safe outcome", without: bm.outcomes.baseline_safe_outcome, with: bm.outcomes.protected_safe_outcome }]} height={180} caption="“Safe outcome” = the run succeeded, was recovered, or was stopped before doing harm." />
            <div className="kpis small">
              <Kpi label="Catches real failures" value={pct(bm.detection.micro_recall, 0)} hint={meta.metrics.recall?.plain} />
              <Kpi label="Flags are correct" value={pct(bm.detection.micro_precision, 0)} hint={meta.metrics.precision?.plain} />
              <Kpi label="Recovery success" value={pct(bm.recovery.recovery_success_rate, 0)} hint={meta.metrics.recovery_success?.plain} />
              <Kpi label="Added delay" value={bm.latency_ms.mean_added.toFixed(2) + " ms"} hint={meta.metrics.latency?.plain} />
            </div>
            <p className="muted wide">Results come from synthetic scenarios and say little about real-agent performance. <button className="linkbtn" onClick={() => go("/bench")}>Details →</button></p>
          </div>)}
      </Card>
    </div>
  );
}
