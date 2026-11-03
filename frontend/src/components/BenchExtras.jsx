import { catLabel, useMeta } from "../api";
import { Caption, Card, Info, Kpi, pct } from "../ui";
/** Risk-prediction results and per-split detection quality for one benchmark run. */
export default function BenchExtras({ m }) {
  const meta = useMeta(), r = m.risk, splits = Object.entries(m.by_split ?? {});
  return (<>
    {r && <Card title="Early warnings" sub="Did the risk score warn before the failure, and was it right? Graded against the ground-truth labels" hint={r.definitions?.early_precision}>
      <div className="kpis">
        <Kpi label="Warnings that came true" value={pct(r.early_precision, 0)} sub={`${r.n_occurred} of ${r.n_alerts} warnings`} hint={r.definitions?.early_precision} />
        <Kpi label="Failures warned about first" value={pct(r.early_recall, 0)} sub={`${r.n_failures} predictable failures`} hint={r.definitions?.early_recall} />
        <Kpi label="Average head start" value={r.avg_lead_steps == null ? "n/a" : r.avg_lead_steps.toFixed(1) + " steps"} hint={r.definitions?.lead} />
        <Kpi label="Needless alarms" value={pct(r.false_intervention_rate, 0)} sub={`${pct(r.false_alert_rate_on_clean_runs, 0)} of healthy runs got a warning`} hint={r.definitions?.false_intervention} />
      </div>
      <div className="scroll"><table className="tbl"><thead><tr><th>Failure type</th><th>Warned first</th></tr></thead><tbody>{Object.entries(r.per_category).map(([k, v]) => <tr key={k}><td>{catLabel(meta, k)}</td><td style={{ background: `rgba(${v.caught / v.total >= 0.8 ? "61,220,151" : v.caught / v.total >= 0.4 ? "255,209,102" : "255,93,115"},.25)` }}>{v.caught} of {v.total}</td></tr>)}</tbody></table></div>
      <Caption>Types with no early signal at all (they can only be detected after they happen): {r.not_covered_failure_types.map((c) => catLabel(meta, c)).join(", ") || "none"}. A first-ever tool failure cannot be predicted, so it shows as 0.</Caption>
    </Card>}
    {splits.length > 1 && <Card title="Does it hold up on unseen scenarios?" sub="Scenarios are split 60/20/20 by a fixed hash of their id, so a scenario can never move between sets" hint="If the held-out test set is much worse than the development set, the rules were tuned too closely to the development examples.">
      <div className="scroll"><table className="tbl"><thead><tr><th>Set</th><th>Scenarios</th><th>Precision</th><th>Recall</th><th>False alarms on healthy runs</th><th>Early-warning precision</th></tr></thead><tbody>
        {splits.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v.n}</td><td>{pct(v.precision, 1)}</td><td>{pct(v.recall, 1)}</td><td>{pct(v.false_positive_rate, 1)} <span className="muted small">(n={v.n_clean})</span></td><td>{pct(v.risk_early_precision, 0)}</td></tr>)}</tbody></table></div>
      <Caption>The detectors were written and adjusted while looking at these scenarios, so even the test set is not fully independent. Treat it as a consistency check, not proof.</Caption>
    </Card>}
  </>);
}
