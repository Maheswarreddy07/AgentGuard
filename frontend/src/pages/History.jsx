import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { historyApi, paths, useApi, useAuth } from "../api";
import { go } from "../router";
import ActivityTimeline from "../components/ActivityTimeline";
import EmptyState from "../components/EmptyState";
import { ACCENT, BAD, Caption, Card, Chip, GOOD, MUTED, State, Tabs, WARN, chartTip, pct } from "../ui";

const targetLink = (a) => ({ recovery_simulated: (t) => "#/traces/" + t, ai_diagnosis_requested: (t) => "#/traces/" + t, benchmark_started: (t) => "#/bench?run=" + t, scenario_added: () => "#/scenarios" })[a.action]?.(a.target) ?? null;

function Timeline({ kind }) {
  const [action, setAction] = useState(""), [items, setItems] = useState([]), [acts, setActs] = useState({}), [total, setTotal] = useState(0), [state, setState] = useState({ loading: true, error: null });
  const load = (offset, replace) => {
    setState({ loading: true, error: null });
    historyApi.activity({ kind, limit: 20, offset, action }).then((r) => { setActs(r.actions); setTotal(r.total); setItems((x) => (replace ? r.items : [...x, ...r.items])); setState({ loading: false, error: null }); }).catch((e) => setState({ loading: false, error: e.message }));
  };
  useEffect(() => { load(0, true); }, [kind, action]); // eslint-disable-line
  const shown = Object.entries(acts).filter(([, v]) => kind === "all" || v.kind === kind).map(([k, v]) => [k, v.label]);
  return (
    <div className="stack">
      <div className="chips"><Chip active={!action} onClick={() => setAction("")}>Everything</Chip>{shown.map(([k, l]) => <Chip key={k} active={action === k} onClick={() => setAction(action === k ? "" : k)}>{l}</Chip>)}</div>
      <State loading={state.loading && items.length === 0} error={state.error} h={160} />
      {!state.loading && items.length === 0 && !state.error && <EmptyState title="Nothing recorded yet" icon="🕘"><p className="muted">Actions like running a benchmark or simulating a recovery will appear here.</p></EmptyState>}
      <ActivityTimeline items={items} linkFor={targetLink} hasMore={items.length < total} remaining={total - items.length} loading={state.loading} onMore={() => load(items.length, false)} />
    </div>
  );
}

function BenchHistory() {
  const h = useApi(paths.benchmarkHistory);
  if (!h.data) return <State loading={h.loading} error={h.error} h={240} onRetry={h.reload} />;
  const rows = h.data.items.map((r, i) => ({ ...r, n: `#${i + 1}`, label: new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
  if (rows.length === 0) return <EmptyState title="No benchmark runs yet" icon="⚗" action={<button className="btn primary" onClick={() => go("/bench")}>Open Benchmark Lab</button>} />;
  const cfg = (c) => `retries ${c.max_retries ?? "?"} · loop at ${c.retry_loop_threshold ?? "?"}${c.disabled_rules?.length ? ` · rules off: ${c.disabled_rules.join(", ")}` : ""}`;
  return (
    <div className="stack">
      <Card title="How results changed over time" sub="One point per completed benchmark run">
        <div style={{ height: 280 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ right: 20 }}><CartesianGrid stroke="#2a3140" vertical={false} /><XAxis dataKey="n" stroke={MUTED} fontSize={12} label={{ value: "Run number (oldest → newest)", position: "insideBottom", offset: -4, fill: MUTED, fontSize: 11 }} height={44} />
          <YAxis domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} width={42} /><Tooltip {...chartTip} formatter={(v) => pct(v)} labelFormatter={(l, p) => p?.[0]?.payload?.label ?? l} /><Legend verticalAlign="top" />
          <Line dataKey="safe_with" name="Safe outcome (with AgentGuard)" stroke={GOOD} strokeWidth={2.5} dot /><Line dataKey="safe_without" name="Safe outcome (without)" stroke={BAD} strokeDasharray="5 4" dot />
          <Line dataKey="recall" name="Failures caught" stroke={ACCENT} dot /><Line dataKey="precision" name="Flags that were right" stroke={WARN} dot /></LineChart></ResponsiveContainer></div>
        <Caption>Lines going up are good. If a line drops after you changed a setting, that change made AgentGuard worse at that job.</Caption>
      </Card>
      <Card title="All runs">
        <div className="scroll"><table className="tbl"><thead><tr><th>#</th><th>When</th><th>Scope</th><th>Safe outcome</th><th>Failures caught</th><th>Flags right</th><th>Settings used</th><th /></tr></thead><tbody>
          {[...rows].reverse().map((r) => <tr key={r.run_id}><td>{r.n}</td><td>{r.label}</td><td>{r.n_scenarios} · {r.scope}</td><td>{pct(r.safe_without, 0)} → <b>{pct(r.safe_with, 0)}</b></td><td>{pct(r.recall, 0)}</td><td>{pct(r.precision, 0)}</td><td className="muted small">{cfg(r.config)}</td>
            <td><button className="btn" onClick={() => go("/bench", { run: r.run_id })}>Open</button></td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}

export default function History({ params }) {
  const { can } = useAuth(), admin = can("admin");
  const [tab, setTab] = useState(params.tab ?? "activity");
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "activity", label: "Activity" }, { key: "benchmarks", label: "Benchmark trend" }, ...(admin ? [{ key: "security", label: "Security log" }] : [])]} />
      {tab === "activity" && <Timeline kind={admin ? "activity" : "all"} />}
      {tab === "benchmarks" && <BenchHistory />}
      {tab === "security" && admin && <Timeline kind="security" />}
    </div>
  );
}
