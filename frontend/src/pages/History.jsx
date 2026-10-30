import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useApi, useAuth } from "../api";
import { go } from "../router";
import { ACCENT, BAD, Caption, Card, Chip, Empty, GOOD, MUTED, State, Tabs, WARN, chartTip, pct, timeAgo, when } from "../ui";

const targetLink = (a) => ({ recovery_simulated: (t) => "#/traces/" + t, ai_diagnosis_requested: (t) => "#/traces/" + t, benchmark_started: (t) => "#/bench?run=" + t, scenario_added: () => "#/scenarios" })[a.action]?.(a.target);
const pretty = (k, v) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`;

function Timeline({ kind }) {
  const [action, setAction] = useState(""), [items, setItems] = useState([]), [acts, setActs] = useState({}), [total, setTotal] = useState(0), [state, setState] = useState({ loading: true, error: null });
  const load = (offset, replace) => {
    setState({ loading: true, error: null });
    api(`/api/v1/history/activity?kind=${kind}&limit=20&offset=${offset}${action ? `&action=${action}` : ""}`).then((r) => { setActs(r.actions); setTotal(r.total); setItems((x) => (replace ? r.items : [...x, ...r.items])); setState({ loading: false, error: null }); }).catch((e) => setState({ loading: false, error: e.message }));
  };
  useEffect(() => { load(0, true); }, [kind, action]); // eslint-disable-line
  const shown = Object.entries(acts).filter(([, v]) => kind === "all" || v.kind === kind).map(([k, v]) => [k, v.label]);
  return (
    <div className="stack">
      <div className="chips"><Chip active={!action} onClick={() => setAction("")}>Everything</Chip>{shown.map(([k, l]) => <Chip key={k} active={action === k} onClick={() => setAction(action === k ? "" : k)}>{l}</Chip>)}</div>
      <State loading={state.loading && items.length === 0} error={state.error} h={160} />
      {!state.loading && items.length === 0 && !state.error && <Empty title="Nothing recorded yet" icon="🕘"><p className="muted">Actions like running a benchmark or simulating a recovery will appear here.</p></Empty>}
      <ol className="timeline">{items.map((a) => { const link = targetLink(a); return (
        <li key={a.id} className={"tl " + a.kind}><span className="tl-dot" aria-hidden="true" />
          <div className="tl-body"><div className="tl-top"><b>{a.label}</b>{a.target && (link ? <a href={link} className="tag">{a.target}</a> : <span className="tag">{a.target}</span>)}<span className="muted small" title={when(a.ts)}>{timeAgo(a.ts)} · by {a.actor}</span></div>
            {Object.keys(a.detail ?? {}).length > 0 && <div className="muted small">{Object.entries(a.detail).map(([k, v]) => pretty(k, v)).join(" · ")}</div>}</div></li>); })}</ol>
      {items.length < total && <button className="btn" disabled={state.loading} onClick={() => load(items.length, false)}>Show more ({total - items.length} older)</button>}
    </div>
  );
}

function BenchHistory() {
  const h = useApi("/api/v1/history/benchmarks");
  if (!h.data) return <State loading={h.loading} error={h.error} h={240} />;
  const rows = h.data.items.map((r, i) => ({ ...r, n: `#${i + 1}`, label: new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
  if (rows.length === 0) return <Empty title="No benchmark runs yet" icon="⚗"><button className="btn primary" onClick={() => go("/bench")}>Open Benchmark Lab</button></Empty>;
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
