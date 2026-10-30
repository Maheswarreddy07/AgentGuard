import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, catLabel, useApi, useMeta } from "../api";
import { go } from "../router";
import { ACCENT, BAD, Card, GOOD, Kpi, MUTED, SEV, SevBadge, State, chartTip, pct, timeAgo, Chip } from "../ui";

function GettingStarted({ onLoaded }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  async function load() { setBusy(true); try { await api("/api/v1/demo/seed", { method: "POST" }); onLoaded(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <Card title="Welcome — nothing to show yet" className="hero">
      <ol className="steps">
        <li><b>Load demo data</b> — a set of synthetic agent runs (some healthy, some broken) so you can explore.</li>
        <li><b>Open a flagged run</b> in Traces to see exactly where it went wrong.</li>
        <li><b>Run the Benchmark Lab</b> to measure how much AgentGuard helps.</li>
      </ol>
      <button className="btn primary" disabled={busy} onClick={load}>{busy ? "Loading…" : "Load demo data"}</button>
      {err && <p role="alert" className="alert">{err}</p>}
      <p className="muted">Have a real agent? See Settings → “Connect your agent”.</p>
    </Card>
  );
}

export function Health({ live }) {
  const data = [{ name: "Healthy runs", value: live.clean_runs, c: GOOD }, { name: "Flagged runs", value: live.runs_with_findings, c: BAD }];
  return (
    <div className="health">
      <div className="donut">
        <ResponsiveContainer width="100%" height={170}>
          <PieChart><Pie data={data} dataKey="value" innerRadius={55} outerRadius={78} stroke="none" paddingAngle={2}>{data.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip {...chartTip} /></PieChart>
        </ResponsiveContainer>
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
  const cats = Object.entries(live.by_category).map(([key, count]) => ({ key, label: catLabel(meta, key), count })).sort((a, b) => b.count - a.count);
  const urgent = (live.by_severity.critical ?? 0) + (live.by_severity.high ?? 0);
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Agent health" hint="Share of runs where no rule found a problem."><Health live={live} /></Card>
        <div className="kpis">
          <Kpi label="Runs observed" value={live.total_runs} sub="all time" />
          <Kpi label="Flagged runs" value={live.runs_with_findings} sub={pct(live.failure_rate, 0) + " of runs"} tone={BAD} hint="Runs where at least one failure rule fired." />
          <Kpi label="Urgent incidents" value={urgent} sub="critical + high severity" tone={SEV.critical} hint="Runs whose worst finding is critical or high." />
          <Kpi label="Healthy runs" value={live.clean_runs} sub="no findings" tone={GOOD} />
        </div>
      </div>

      <Card title="What is going wrong" hint="Number of runs affected by each type of failure. Click a bar to see those runs.">
        <div style={{ height: 34 * cats.length + 30 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cats} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="#2a3140" />
              <XAxis type="number" allowDecimals={false} stroke={MUTED} fontSize={12} />
              <YAxis type="category" dataKey="label" width={190} interval={0} stroke={MUTED} fontSize={12} />
              <Tooltip {...chartTip} formatter={(v) => [v + " runs", "Affected"]} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => go("/traces", { category: d?.payload?.key ?? d?.key })}>{cats.map((c) => <Cell key={c.key} fill={ACCENT} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="By severity" hint="Each run counts once, at its worst finding.">
          <div className="sev-row">
            {["critical", "high", "medium", "low"].map((s) => (
              <button key={s} className="sev-tile" style={{ "--c": SEV[s] }} onClick={() => go("/traces", { severity: s })}><b>{live.by_severity[s] ?? 0}</b><span>{s}</span></button>
            ))}
          </div>
        </Card>
        <Card title="Runs over time" hint="Runs per day and how many were flagged.">
          {tr.data?.items?.length ? (
            <div style={{ height: 150 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={tr.data.items}><CartesianGrid stroke="#2a3140" vertical={false} /><XAxis dataKey="date" stroke={MUTED} fontSize={11} /><YAxis allowDecimals={false} stroke={MUTED} fontSize={11} width={28} /><Tooltip {...chartTip} /><Legend />
              <Area dataKey="runs" name="Runs" stroke={ACCENT} fill={ACCENT} fillOpacity={0.2} /><Area dataKey="with_findings" name="Flagged" stroke={BAD} fill={BAD} fillOpacity={0.25} /></AreaChart></ResponsiveContainer></div>
          ) : <p className="muted">Not enough data yet.</p>}
        </Card>
      </div>

      <Card title="Recent urgent incidents" right={<button className="btn" onClick={() => go("/traces", { sort: "severity", status: "flagged" })}>View all flagged</button>}>
        {live.recent_incidents.length === 0 ? <p className="muted">No critical or high-severity incidents. 🎉</p> : (
          <ul className="incidents">{live.recent_incidents.map((t) => (
            <li key={t.trace_id}><a href={"#/traces/" + t.trace_id} className="incident" style={{ "--c": SEV[t.max_severity] }}>
              <SevBadge sev={t.max_severity} /><span className="inc-t">{t.headline}</span>
              <span className="muted">{t.categories.map((c) => catLabel(meta, c)).join(" · ")} · {timeAgo(t.created_at)}</span><span className="go">Investigate →</span></a></li>))}</ul>
        )}
      </Card>

      <Card title="AgentGuard benchmark" right={<span className="badge">synthetic · simulated</span>}>
        {!bm ? <p className="muted">No benchmark has been run yet. <button className="btn" onClick={() => go("/bench")}>Open Benchmark Lab</button></p> : (
          <div className="grid-2">
            <div style={{ height: 170 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ n: "Without AgentGuard", v: bm.outcomes.baseline_safe_outcome, c: BAD }, { n: "With AgentGuard", v: bm.outcomes.protected_safe_outcome, c: GOOD }]}>
                <XAxis dataKey="n" stroke={MUTED} fontSize={12} /><YAxis domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} width={40} /><Tooltip {...chartTip} formatter={(v) => pct(v)} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]}>{[BAD, GOOD].map((c) => <Cell key={c} fill={c} />)}</Bar></BarChart></ResponsiveContainer></div>
            <div className="kpis small">
              <Kpi label="Catches real failures" value={pct(bm.detection.micro_recall, 0)} hint={meta.metrics.recall?.plain} />
              <Kpi label="Flags are correct" value={pct(bm.detection.micro_precision, 0)} hint={meta.metrics.precision?.plain} />
              <Kpi label="Recovery success" value={pct(bm.recovery.recovery_success_rate, 0)} hint={meta.metrics.recovery_success?.plain} />
              <Kpi label="Added delay" value={bm.latency_ms.mean_added.toFixed(2) + " ms"} hint={meta.metrics.latency?.plain} />
            </div>
            <p className="muted wide">“Safe outcome” = the run succeeded, was recovered, or was stopped before doing harm. Results come from synthetic scenarios and say little about real-agent performance. <button className="linkbtn" onClick={() => go("/bench")}>Details →</button></p>
          </div>
        )}
      </Card>
    </div>
  );
}
