import { useState } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { catLabel, paths, scenarioApi, useApi, useAuth, useMeta } from "../api";
import EmptyState from "../components/EmptyState";
import Flow from "../components/Flow";
import ScenarioCard from "../components/ScenarioCard";
import { BAD, Caption, Card, Chip, Drawer, GOOD, Kpi, MUTED, State, chartTip } from "../ui";
const human = (s) => s.replace(/_/g, " ");
const clean = (d) => d.replace(/^\[SYNTHETIC[^\]]*\]\s*/, "");

function Detail({ id, onClose }) {
  const meta = useMeta(), d = useApi(paths.scenario(id));
  const s = d.data, step = s?.labels.earliest_detectable_step, act = s && meta.actions?.[s.labels.expected_action];
  return (
    <Drawer title={id} onClose={onClose}>
      {!s ? <State loading={d.loading} error={d.error} h={200} /> : (<>
        <p className="lead">{clean(s.description)}</p>
        <h4 className="sec">The scripted run</h4>
        <Flow events={s.events} markers={step != null && s.events[step] ? { [s.events[step].event_id]: ["First detectable"] } : {}} />
        <h4 className="sec">What AgentGuard should find</h4>
        {s.labels.failure_categories.length ? <ul className="plain">{s.labels.failure_categories.map((c) => <li key={c}><b>{catLabel(meta, c)}</b><div className="muted small">{meta.categories[c]?.why}</div></li>)}</ul> : <p>Nothing — this run is fine, so AgentGuard should <b>stay quiet</b>. Raising an alarm here counts as a false alarm.</p>}
        <h4 className="sec">What AgentGuard should do about it</h4>
        <div className="plan"><div className="plan-a">{act?.icon} {act?.label ?? s.labels.expected_action}</div><p className="muted">{act?.plain}</p></div>
        <h4 className="sec">Simulated world <span className="muted small">(used only when testing recovery)</span></h4>
        <ul className="plain"><li>Failing retries before success: <b>{s.sim.transient_fail_count}</b></li><li>Corrected arguments valid: <b>{s.sim.corrected_args_valid ? "yes" : "no"}</b></li><li>Extra evidence available: <b>{s.sim.evidence_available ? "yes" : "no"}</b></li></ul>
        <p className="muted small">The expected answer above is hidden from the detectors during a benchmark; it is only used to grade them.</p>
      </>)}
    </Drawer>
  );
}

function AddScenario({ onAdded }) {
  const { can } = useAuth(), tpl = useApi(paths.scenarioTemplate);
  const [text, setText] = useState(null), [msg, setMsg] = useState(null);
  const value = text ?? (tpl.data ? JSON.stringify(tpl.data, null, 1) : "");
  async function add() { try { await scenarioApi.add(value); setMsg({ ok: true, t: "Added — it will be included in the next benchmark run." }); onAdded(); } catch (e) { setMsg({ ok: false, t: "Not saved: " + e.message }); } }
  return (
    <details className="card"><summary className="card-sum">➕ Add your own scenario</summary>
      <p className="muted">Describe a scripted agent run and the answer you expect. The backend checks it before saving. The template below comes from the server.</p>
      <label htmlFor="sj" className="muted small">Scenario JSON</label><textarea id="sj" value={value} onChange={(e) => setText(e.target.value)} />
      <div className="row"><button className="btn primary" disabled={!can("member")} onClick={add}>Validate and add</button>{!can("member") && <span className="muted small">Members and admins only</span>}{msg && <span role="status" className={msg.ok ? "okt" : "errt"}>{msg.t}</span>}</div>
    </details>
  );
}

export default function Scenarios() {
  const { data, error, loading, reload } = useApi(paths.scenarios());
  const [cat, setCat] = useState(""), [kind, setKind] = useState("all"), [q, setQ] = useState(""), [open, setOpen] = useState(null);
  if (!data) return <State loading={loading} error={error} h={240} onRetry={reload} />;
  const items = data.items, quiet = (s) => s.labels.failure_categories.length === 0;
  const fam = {}; items.forEach((s) => { const f = (fam[s.category] ??= { name: human(s.category), key: s.category, quiet: 0, fail: 0 }); quiet(s) ? f.quiet++ : f.fail++; });
  const chart = Object.values(fam).sort((a, b) => b.quiet + b.fail - (a.quiet + a.fail));
  const rows = items.filter((s) => (!cat || s.category === cat) && (kind === "all" || (kind === "quiet") === quiet(s)) && (s.id + s.description).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <Card title="How a scenario works" sub="Every test case follows the same three steps">
        <div className="howto">
          <div><span className="num">1</span><b>A scripted run</b><p className="muted">A fake agent run with a known story — some go wrong, some are fine.</p></div><span className="arrow" aria-hidden="true">→</span>
          <div><span className="num">2</span><b>AgentGuard looks at it</b><p className="muted">The detectors see only the steps, never the answer key.</p></div><span className="arrow" aria-hidden="true">→</span>
          <div><span className="num">3</span><b>Graded against the truth</b><p className="muted">Did it find the right problems, at the right step, and respond safely?</p></div>
        </div>
      </Card>
      <div className="grid-2">
        <div className="kpis small">
          <Kpi label="Test scenarios" value={items.length} sub={`${chart.length} kinds`} />
          <Kpi label="Contain a failure" value={items.filter((s) => !quiet(s)).length} sub="AgentGuard should react" tone={BAD} onClick={() => setKind("fail")} />
          <Kpi label="Should stay quiet" value={items.filter(quiet).length} sub="a false alarm here is a mistake" tone={GOOD} onClick={() => setKind("quiet")} />
          <Kpi label="Longest scenario" value={Math.max(...items.map((s) => s.n_events))} sub="steps" />
        </div>
        <Card title="Scenarios by kind" sub="Green = should stay quiet, red = contains a failure">
          <div style={{ height: 28 * chart.length + 40 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} layout="vertical" margin={{ left: 6, right: 24 }}>
            <XAxis type="number" allowDecimals={false} stroke={MUTED} fontSize={11} /><YAxis type="category" dataKey="name" width={120} interval={0} stroke={MUTED} fontSize={12} /><Tooltip {...chartTip} /><Legend />
            <Bar dataKey="quiet" name="Should stay quiet" stackId="a" fill={GOOD} cursor="pointer" onClick={(d) => setCat(d.key)} /><Bar dataKey="fail" name="Contains a failure" stackId="a" fill={BAD} cursor="pointer" onClick={(d) => setCat(d.key)} /></BarChart></ResponsiveContainer></div>
          <Caption>Click a bar to show just that kind below.</Caption>
        </Card>
      </div>
      <Card>
        <div className="filters"><label className="field grow">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="id or description" /></label>
          <div className="seg" role="group" aria-label="Show">{[["all", "All"], ["fail", "Contain failures"], ["quiet", "Should stay quiet"]].map(([k, l]) => <button key={k} aria-pressed={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}</div></div>
        <div className="chips"><Chip active={!cat} onClick={() => setCat("")}>All kinds</Chip>{chart.map((c) => <Chip key={c.key} active={cat === c.key} onClick={() => setCat(cat === c.key ? "" : c.key)}>{c.name} ({c.quiet + c.fail})</Chip>)}</div>
      </Card>
      {rows.length === 0 ? <EmptyState title="No scenarios match" icon="🔍" /> : <div className="scn-grid">{rows.map((s) => <ScenarioCard key={s.id} scenario={s} selected={open === s.id} onOpen={(x) => setOpen(x.id)} />)}</div>}
      <Caption>Each square is one step of the scripted run; the ringed square is where the problem first becomes detectable.</Caption>
      <AddScenario onAdded={reload} />
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
