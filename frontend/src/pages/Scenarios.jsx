import { useMemo, useState } from "react";
import { fill, paths, scenarioApi, useApi, useAuth, useText } from "../api";
import { go } from "../router";
import ConfirmDelete from "../components/ConfirmDelete";
import EmptyState from "../components/EmptyState";
import TestCard from "../components/TestCard";
import { State } from "../ui";

/** Add a team-made test. It is kept separate from the built-in library and is never mixed into synthetic results. */
function AddTest({ onAdded }) {
  const { allowed } = useAuth(), a = useText("scenarios").add ?? {}, tpl = useApi(paths.scenarioTemplate), ok = allowed("add_scenario");
  const [text, setText] = useState(null), [msg, setMsg] = useState(null);
  const value = text ?? (tpl.data ? JSON.stringify(tpl.data, null, 1) : "");
  async function add() { try { await scenarioApi.add(value); setMsg({ ok: true, t: a.ok }); onAdded(); } catch (e) { setMsg({ ok: false, t: a.fail + e.message }); } }
  return (
    <details className="card"><summary className="card-sum">➕ {a.summary}</summary>
      <p className="muted">{a.help}</p>
      <label htmlFor="sj" className="muted small">{a.json_label}</label><textarea id="sj" value={value} onChange={(e) => setText(e.target.value)} />
      <div className="row"><button className="btn primary" disabled={!ok} onClick={add}>{a.button}</button>{!ok && <span className="muted small">{a.members_only}</span>}{msg && <span role="status" className={msg.ok ? "okt" : "errt"}>{msg.t}</span>}</div>
    </details>
  );
}

/** Test Library: the situations AgentGuard can be tested against, in eight plain groups, each with its real last result. */
export default function Scenarios() {
  const T = useText("tests"), t = T.library ?? {}, G = T.groups ?? {}, { allowed } = useAuth(), lib = useApi(paths.testLibrary), [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (lib.data?.groups ?? []).map((g) => ({ ...g, tests: g.tests.filter((x) => !needle || [x.name, x.summary, x.checks, x.expected].join(" ").toLowerCase().includes(needle)) })).filter((g) => g.tests.length);
  }, [lib.data, q]);
  if (!lib.data) return <State loading={lib.loading} error={lib.error} h={240} onRetry={lib.reload} />;
  const run = (keys) => go("/run-tests", { pick: keys.join(",") }), canRun = allowed("run_benchmark");
  return (
    <div className="stack">
      <p className="lead">{t.intro}</p>
      <p className="muted small">{t.synthetic_note}</p>
      <label className="field">{t.search}<input type="search" value={q} placeholder={t.search_placeholder} onChange={(e) => setQ(e.target.value)} /></label>
      {lib.data.groups.length === 0 ? <EmptyState icon="🧪" title={t.none_title} /> : groups.length === 0 ? <EmptyState icon="🔍" title={t.empty} /> : groups.map((g) => (
        <section key={g.key} className="lib-group" aria-labelledby={"g-" + g.key}>
          <header className="lib-h"><div><h2 id={"g-" + g.key}>{G[g.key]?.label}</h2><p className="muted">{G[g.key]?.sub}</p></div>
            <button className="btn sm" disabled={!canRun} onClick={() => run(g.tests.map((x) => x.key))}>{t.run_group}</button></header>
          <div className="test-grid">{g.tests.map((x) => <TestCard key={x.key} test={x} canRun={canRun} onRun={() => run([x.key])}
            onDelete={g.key === "custom" && allowed("delete_scenario") ? <ConfirmDelete kind="scenario" vars={{ name: x.name }} onConfirm={() => scenarioApi.remove(x.scenario_ids[0])} onDone={lib.reload} /> : null} />)}</div>
        </section>))}
      <AddTest onAdded={lib.reload} />
    </div>
  );
}
