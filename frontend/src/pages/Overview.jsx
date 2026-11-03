import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, catLabel, useApi, useAuth, useMeta } from "../api";
import { go } from "../router";
import { ACCENT, BAD, Caption, Card, GOOD, Kpi, MUTED, SevBadge, State, chartTip, pct, sevColor, timeAgo } from "../ui";

function GettingStarted({ onLoaded }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  async function load() { setBusy(true); try { await api("/api/v1/demo/seed", { method: "POST" }); onLoaded(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <Card title="Welcome — nothing to show yet" className="hero">
      <ol className="steps">
        <li><b>Load demo data</b> — synthetic agent runs (some healthy, some broken) so you can explore.</li>
        <li><b>Open a flagged run</b> in Traces to see exactly where it went wrong.</li>
        <li><b>Run the Benchmark Lab</b> to measure how much AgentGuard helps.</li>
      </ol>
      <button className="btn primary" disabled={busy || !can("member")} onClick={load}>{busy ? "Loading…" : "Load demo data"}</button>
      {!can("member") && <p className="muted">Ask a member or admin to load demo data, or connect a real agent (Settings → Connect an agent).</p>}
      {err && <p role="alert" className="alert">{err}</p>}
    </Card>
  );
}

export function Health({ live }) {
  const data = [{ name: "Healthy runs", value: live.clean_runs, c: GOOD }, { name: "Flagged runs", value: live.runs_with_findings, c: BAD }];
  return (
    <div className="health">
      <div className="donut">
        <ResponsiveContainer width="100%" height={170}><PieChart><Pie data={data} dataKey="value" innerRadius={55} outerRadius={78} stroke="none" paddingAngle={2}>{data.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip {...chartTip} /></PieChart></ResponsiveContainer>
        <div className="donut-c"><b>{pct(1 - (live.failure_rate ?? 0), 0)}</b><span>healthy</span></div>
      </div>
      <ul className="legend">{data.map((d) => <li key={d.name}><i style={{ background: d.c }} />{d.name}<b>{d.value}</b></li>)}</ul>
    </div>
  );
}

export default function Overview() {
  const meta = useMeta();
  const ov = useApi("/api/v1/metrics/overview"), tr = useApi("/api/v1/metrics/trends");
  if (!ov.data) return <State loading={ov.loading} error={ov.error} h={300} />;
  const { live, benchmark: bm } = ov.data;
  const reload = () => { ov.reload(); tr.reload(); };
  if (live.total_runs === 0) return <GettingStarted onLoaded={reload} />;
  const cats = Object.entries(live.category_stats).map(([key, v]) => ({ key, label: catLabel(meta, key), count: v.count, sev: v.max_severity })).sort((a, b) => b.count - a.count);
  const urgent = ["critical", "high"].reduce((n, s) => n + (live.by_severity[s] ?? 0), 0);
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Agent health" sub="Share of runs where no rule found a problem" hint="A run is “flagged” when at least one detection rule fired."><Health live={live} /></Card>
        <div className="kpis">
          <Kpi label="Runs observed" value={live.total_runs} sub="all time" onClick={() => go("/traces")} />
          <Kpi label="Flagged runs" value={live.runs_with_findings} sub={pct(live.failure_rate, 0) + " of runs"} tone={BAD} onClick={() => go("/traces", { status: "flagged" })} />
          <Kpi label="Urgent incidents" value={urgent} sub={meta.severities.filter((s) => ["critical", "high"].includes(s)).join(" + ")} tone={sevColor("critical")} hint="Runs whose worst finding is critical or high." onClick={() => go("/traces", { sort: "severity", status: "flagged" })} />
          <Kpi label="Healthy runs" value={live.clean_runs} sub="no findings" tone={GOOD} onClick={() => go("/traces", { status: "clean" })} />
        </div>
      </div>

      <Card title="Operations" sub="What AgentGuard has been doing for your agents">
        <div className="kpis">
          <Kpi label="Waiting for approval" value={live.pending_approvals} tone={live.pending_approvals ? sevColor("high") : undefined} onClick={() => go("/approvals")} hint="Actions an agent is not allowed to take without a person saying yes." />
          <Kpi label="Actions blocked" value={live.blocked_actions} sub={`${live.blocked_runs} run${live.blocked_runs === 1 ? "" : "s"} stopped`} onClick={() => go("/policies")} hint="Tool calls a policy stopped before they ran." />
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

      <Card title="Recent urgent incidents" sub="Most severe first" right={<button className="btn" onClick={() => go("/traces", { sort: "severity", status: "flagged" })}>View all flagged</button>}>
        {live.recent_incidents.length === 0 ? <p className="muted">No critical or high-severity incidents. 🎉</p> : (
          <ul className="incidents">{live.recent_incidents.map((t) => (
            <li key={t.trace_id}><a href={"#/traces/" + t.trace_id} className="incident" style={{ "--c": sevColor(t.max_severity) }}>
              <SevBadge sev={t.max_severity} /><span className="inc-t">{t.headline}</span>
              <span className="muted">{t.categories.map((c) => catLabel(meta, c)).join(" · ")} · {timeAgo(t.created_at)}</span><span className="go">Investigate →</span></a></li>))}</ul>)}
      </Card>

      <Card title="AgentGuard benchmark" sub="How much the protection layer helps" right={<span className="badge">synthetic · simulated</span>}>
        {!bm ? <p className="muted">No benchmark has been run yet. <button className="btn" onClick={() => go("/bench")}>Open Benchmark Lab</button></p> : (
          <div className="grid-2">
            <div>
              <div style={{ height: 180 }}><ResponsiveContainer width="100%" height="100%">
                <BarChart data={[{ n: "Without AgentGuard", v: bm.outcomes.baseline_safe_outcome }, { n: "With AgentGuard", v: bm.outcomes.protected_safe_outcome }]}>
                  <XAxis dataKey="n" stroke={MUTED} fontSize={12} /><YAxis domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} width={40} /><Tooltip {...chartTip} formatter={(v) => pct(v)} />
                  <Bar dataKey="v" radius={[6, 6, 0, 0]}>{[BAD, GOOD].map((c) => <Cell key={c} fill={c} />)}<LabelList dataKey="v" position="top" formatter={(v) => pct(v, 0)} fill="#e8eaf0" fontSize={13} /></Bar></BarChart></ResponsiveContainer></div>
              <Caption>“Safe outcome” = the run succeeded, was recovered, or was stopped before doing harm.</Caption>
            </div>
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
