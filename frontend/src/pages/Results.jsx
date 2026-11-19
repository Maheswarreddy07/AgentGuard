import { useMemo, useState } from "react";
import { benchmarkApi, download, fill, paths, useApi, useText } from "../api";
import { go } from "../router";
import EmptyState from "../components/EmptyState";
import TechnicalDetails from "../components/TechnicalDetails";
import { Card, Kpi, State, pct, when } from "../ui";

/** A count is only ever shown with what it is out of. Nothing out of nothing is shown as a score. */
const ratio = (r, n, d) => (d ? fill(r.of, { n, d }) : r.not_enough);
const rate = (r, v, d) => (v == null || !d ? r.not_enough : `${pct(v, 1)} · ${fill(r.m_denominator, { d })}`);

function Detailed({ run, r }) {
  const g = useApi(paths.benchmark(run)), m = g.data?.metrics;
  if (!m) return <State loading={g.loading} error={g.error} h={80} />;
  const dn = m.denominators ?? {}, ci = m.ci95_wilson ?? {}, row = (label, v, d, c) => (
    <tr key={label}><td>{label}</td><td>{rate(r, v, d)}</td><td className="muted small">{c ? fill(r.m_interval, { lo: pct(c[0], 1), hi: pct(c[1], 1) }) : ""}</td></tr>);
  return (<>
    <p className="muted small">{r.tech_intro}</p>
    <table className="tbl"><tbody>
      {row(r.m_precision, m.detection.micro_precision, dn.precision, ci.micro_precision)}
      {row(r.m_recall, m.detection.micro_recall, dn.recall, ci.micro_recall)}
      {row(r.m_f1, m.detection.micro_f1, Math.max(dn.precision ?? 0, dn.recall ?? 0))}
      {row(r.m_fpr, m.detection.false_positive_rate, dn.false_positive_rate, ci.false_positive_rate)}
      {row(r.m_loc, m.localization.accuracy, dn.localization, ci.localization)}
      {row(r.m_rec, m.recovery.recovery_success_rate, dn.recovery, ci.recovery_success)}
    </tbody></table>
  </>);
}

/** Results: what each recorded test run found. Every figure is counted from that run's stored records. */
export default function Results({ params = {} }) {
  const T = useText("tests"), r = T.results ?? {}, G = T.groups ?? {}, runs = useApi(paths.benchmarks), lib = useApi(paths.testLibrary), [pickedRun, setPickedRun] = useState(null);
  const done = useMemo(() => (runs.data?.items ?? []).filter((x) => x.status === "completed"), [runs.data]);
  const run = pickedRun ?? params.run ?? done[0]?.run_id ?? null, sum = useApi(run ? paths.benchmarkSummary(run) : null);
  const names = useMemo(() => Object.fromEntries((lib.data?.groups ?? []).flatMap((g) => g.tests.flatMap((x) => x.scenario_ids.map((i) => [i, x.name])))), [lib.data]);
  if (!runs.data) return <State loading={runs.loading} error={runs.error} h={240} onRetry={runs.reload} />;
  if (done.length === 0) return <EmptyState icon="📊" title={r.none_title} action={<button className="btn primary" onClick={() => go("/run-tests")}>{r.run_first}</button>} />;
  const s = sum.data;
  return (
    <div className="stack">
      <div className="row"><p className="lead">{r.intro}</p>
        <label className="field inline push">{r.choose}<select value={run ?? ""} onChange={(e) => { setPickedRun(e.target.value); go("/results", { run: e.target.value }); }}>
          {done.map((x) => <option key={x.run_id} value={x.run_id}>{fill(r.run_label, { when: when(x.created_at), n: x.n_scenarios })}</option>)}</select></label></div>
      {!s ? <State loading={sum.loading} error={sum.error} h={200} onRetry={sum.reload} /> : (<>
        <div className="callout"><b>{r.kind_synthetic}.</b> {r.kind_note}</div>
        <Card title={r.headline} className="verdict">
          {s.executed > 0 ? <p className="verdict-t">{fill(r.headline_body, { of: s.safe.of, without: s.safe.without, with: s.safe.with })}</p> : <p>{r.headline_not_enough}</p>}
          <p className="muted small">{r.baseline_note}</p>
          <dl className="conds"><div><dt>{r.cond_dataset}</dt><dd>{s.dataset?.name} ({s.dataset?.kind})</dd></div><div><dt>{r.cond_situations}</dt><dd>{s.executed}</dd></div>
            <div><dt>{r.cond_ran}</dt><dd>{s.ran_at ? when(s.ran_at) : r.not_enough}</dd></div><div><dt>{r.cond_detector}</dt><dd>{s.versions?.detector}</dd></div><div><dt>{r.cond_version}</dt><dd>{s.versions?.agentguard}</dd></div></dl>
        </Card>
        <div className="callout warn"><b>{r.caveat_title}.</b> {r.caveat}</div>
        <div className="kpis">
          <Kpi label={r.executed} value={s.executed} sub={r.exp_executed} />
          <Kpi label={r.passed} value={ratio(r, s.passed, s.executed)} sub={r.exp_passed} tone="var(--good)" />
          <Kpi label={r.failed} value={ratio(r, s.failed, s.executed)} sub={r.exp_failed} tone={s.failed ? "var(--bad)" : undefined} />
          <Kpi label={r.problems} value={ratio(r, s.problems.caught, s.problems.of)} sub={r.exp_problems} />
          <Kpi label={r.prevented} value={ratio(r, s.prevented.n, s.prevented.of)} sub={r.exp_prevented} />
          <Kpi label={r.recoveries} value={ratio(r, s.recoveries.verified, s.recoveries.of)} sub={r.exp_recoveries} />
          <Kpi label={r.unnecessary} value={ratio(r, s.unnecessary_warnings.n, s.unnecessary_warnings.of)} sub={r.exp_unnecessary} />
          <Kpi label={r.delay} value={s.added_ms == null ? r.not_enough : s.added_ms.toFixed(2) + " ms"} sub={r.exp_delay} />
        </div>
        {s.sample_warnings.length > 0 && <ul className="plain muted small">{s.sample_warnings.map((w) => <li key={w.scope}>{fill(r.small_sample, { message: w.message })}</li>)}</ul>}
        <Card title={r.by_group} sub={r.by_group_sub}>
          <ul className="plain group-rows">{Object.entries(s.by_group).map(([k, v]) => <li key={k}><span>{G[k]?.label ?? k}</span><b>{ratio(r, v.passed, v.total)}</b></li>)}</ul>
        </Card>
        <Card title={r.failed_title}>
          {s.failed_tests.length === 0 ? <p className="muted">{r.failed_none}</p> : <ul className="plain">{s.failed_tests.map((f) => <li key={f.id}><b>{names[f.id] ?? f.id}</b>
            {f.missed.length > 0 && <div className="muted small">{fill(r.missed, { list: f.missed.join(", ").replace(/_/g, " ") })}</div>}{f.extra.length > 0 && <div className="muted small">{fill(r.extra, { list: f.extra.join(", ").replace(/_/g, " ") })}</div>}</li>)}</ul>}
        </Card>
        <TechnicalDetails title={r.tech_extra}><Detailed run={run} r={r} /></TechnicalDetails>
        <div className="row"><button className="btn" onClick={async () => { const [g, all] = await Promise.all([benchmarkApi.get(run), benchmarkApi.results(run)]); download(`agentguard-${run}.json`, JSON.stringify({ summary: s, metrics: g.metrics, results: all.results }, null, 1), "application/json"); }}>{r.export}</button></div>
      </>)}
    </div>
  );
}
