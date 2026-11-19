import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { historyApi, paths, useApi, useAuth } from "../api";
import { go } from "../router";
import ActivityTimeline from "../components/ActivityTimeline";
import EmptyState from "../components/EmptyState";
import { ACCENT, BAD, Caption, Card, Chip, GOOD, MUTED, State, Tabs, WARN, chartTip, pct } from "../ui";
import { useT } from "../hooks/context";

const targetLink = (a) => ({ recovery_simulated: (t) => "#/traces/" + t, ai_diagnosis_requested: (t) => "#/traces/" + t, benchmark_started: (t) => "#/results?run=" + t, scenario_added: () => "#/scenarios" })[a.action]?.(a.target) ?? null;

function Timeline({ kind }) {
  const txt = useT("history");
  const [action, setAction] = useState(""), [items, setItems] = useState([]), [acts, setActs] = useState({}), [total, setTotal] = useState(0), [state, setState] = useState({ loading: true, error: null });
  const load = (offset, replace) => {
    setState({ loading: true, error: null });
    historyApi.activity({ kind, limit: 20, offset, action }).then((r) => { setActs(r.actions); setTotal(r.total); setItems((x) => (replace ? r.items : [...x, ...r.items])); setState({ loading: false, error: null }); }).catch((e) => setState({ loading: false, error: e.message }));
  };
  useEffect(() => { load(0, true); }, [kind, action]); // eslint-disable-line
  const shown = Object.entries(acts).filter(([, v]) => kind === "all" || v.kind === kind).map(([k, v]) => [k, v.label]);
  return (
    <div className="stack">
      <div className="chips"><Chip active={!action} onClick={() => setAction("")}>{txt("everything")}</Chip>{shown.map(([k, l]) => <Chip key={k} active={action === k} onClick={() => setAction(action === k ? "" : k)}>{l}</Chip>)}</div>
      <State loading={state.loading && items.length === 0} error={state.error} h={160} />
      {!state.loading && items.length === 0 && !state.error && <EmptyState title={txt("nothing_recorded_yet")} icon="🕘"><p className="muted">{txt("actions_like_running_a_benchmark")}</p></EmptyState>}
      <ActivityTimeline items={items} linkFor={targetLink} hasMore={items.length < total} remaining={total - items.length} loading={state.loading} onMore={() => load(items.length, false)} />
    </div>
  );
}

function BenchHistory() {
  const txt = useT("history");
  const h = useApi(paths.benchmarkHistory);
  if (!h.data) return <State loading={h.loading} error={h.error} h={240} onRetry={h.reload} />;
  const rows = h.data.items.map((r, i) => ({ ...r, n: `#${i + 1}`, label: new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
  if (rows.length === 0) return <EmptyState title={txt("no_benchmark_runs_yet")} icon="⚗" action={<button className="btn primary" onClick={() => go("/run-tests")}>{txt("open_benchmark_lab")}</button>} />;
  const cfg = (c) => txt("cfg", { retries: c.max_retries ?? "?", loop: c.retry_loop_threshold ?? "?", off: c.disabled_rules?.length ? txt("cfg_off", { rules: c.disabled_rules.join(", ") }) : "" });
  return (
    <div className="stack">
      <Card title={txt("how_results_changed_over_time")} sub={txt("one_point_per_completed_benchmark")}>
        <div style={{ height: 280 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ right: 20 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="n" stroke={MUTED} fontSize={12} label={{ value: txt("x_label"), position: "insideBottom", offset: -4, fill: MUTED, fontSize: 11 }} height={44} />
          <YAxis domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} width={42} /><Tooltip {...chartTip} formatter={(v) => pct(v)} labelFormatter={(l, p) => p?.[0]?.payload?.label ?? l} /><Legend verticalAlign="top" />
          <Line dataKey="safe_with" name="Safe outcome (with AgentGuard)" stroke={GOOD} strokeWidth={2.5} dot /><Line dataKey="safe_without" name="Safe outcome (without)" stroke={BAD} strokeDasharray="5 4" dot />
          <Line dataKey="recall" name="Failures caught" stroke={ACCENT} dot /><Line dataKey="precision" name="Flags that were right" stroke={WARN} dot /></LineChart></ResponsiveContainer></div>
        <Caption>{txt("lines_going_up_are_good")}</Caption>
      </Card>
      <Card title={txt("all_runs")}>
        <div className="scroll"><table className="tbl"><thead><tr><th>#</th><th>{txt("when")}</th><th>{txt("scope")}</th><th>{txt("safe_outcome")}</th><th>{txt("failures_caught")}</th><th>{txt("flags_right")}</th><th>{txt("settings_used")}</th><th /></tr></thead><tbody>
          {[...rows].reverse().map((r) => <tr key={r.run_id}><td>{r.n}</td><td>{r.label}</td><td>{r.n_scenarios} · {r.scope}</td><td>{pct(r.safe_without, 0)} → <b>{pct(r.safe_with, 0)}</b></td><td>{pct(r.recall, 0)}</td><td>{pct(r.precision, 0)}</td><td className="muted small">{cfg(r.config)}</td>
            <td><button className="btn" onClick={() => go("/results", { run: r.run_id })}>{txt("open")}</button></td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}

export default function History({ params }) {
  const txt = useT("history");
  const { allowed } = useAuth(), admin = allowed("view_security_log");
  const [tab, setTab] = useState(params.tab ?? "activity");
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "activity", label: txt("tab_activity") }, { key: "benchmarks", label: txt("tab_bench") }, ...(admin ? [{ key: "security", label: txt("tab_security") }] : [])]} />
      {tab === "activity" && <Timeline kind={admin ? "activity" : "all"} />}
      {tab === "benchmarks" && <BenchHistory />}
      {tab === "security" && admin && <Timeline kind="security" />}
    </div>
  );
}
