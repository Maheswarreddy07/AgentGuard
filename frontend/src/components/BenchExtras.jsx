import { catLabel, useMeta } from "../hooks/context";
import { Caption, Card, Info, Kpi, pct } from "../ui";
import { useT } from "../hooks/context";
/** Risk-prediction results and per-split detection quality for one benchmark run. */
export default function BenchExtras({ m }) {
  const txt = useT("bench_extras");
  const meta = useMeta(), r = m.risk, splits = Object.entries(m.by_split ?? {});
  return (<>
    {r && <Card title={txt("early_warnings")} sub={txt("did_the_risk_score_warn")} hint={r.definitions?.early_precision}>
      <div className="kpis">
        <Kpi label={txt("warnings_that_came_true")} value={pct(r.early_precision, 0)} sub={txt("n_occurred_of_n_alerts", { n_occurred: r.n_occurred, n_alerts: r.n_alerts })} hint={r.definitions?.early_precision} />
        <Kpi label={txt("failures_warned_about_first")} value={pct(r.early_recall, 0)} sub={txt("n_failures_predictable_failures", { n_failures: r.n_failures })} hint={r.definitions?.early_recall} />
        <Kpi label={txt("average_head_start")} value={r.avg_lead_steps == null ? "n/a" : r.avg_lead_steps.toFixed(1) + " steps"} hint={r.definitions?.lead} />
        <Kpi label={txt("needless_alarms")} value={pct(r.false_intervention_rate, 0)} sub={txt("v1_of_healthy_runs_got", { v1: pct(r.false_alert_rate_on_clean_runs, 0) })} hint={r.definitions?.false_intervention} />
      </div>
      <div className="scroll"><table className="tbl"><thead><tr><th>{txt("failure_type")}</th><th>{txt("warned_first")}</th></tr></thead><tbody>{Object.entries(r.per_category).map(([k, v]) => <tr key={k}><td>{catLabel(meta, k)}</td><td style={{ background: `rgba(${v.caught / v.total >= 0.8 ? "61,220,151" : v.caught / v.total >= 0.4 ? "255,209,102" : "255,93,115"},.25)` }}>{txt("caught_of_total", { caught: v.caught, total: v.total })}</td></tr>)}</tbody></table></div>
      <Caption>{txt("types_with_no_early_signal")} {r.not_covered_failure_types.map((c) => catLabel(meta, c)).join(", ") || txt("none")}{txt("a_first_ever_tool_failure")}</Caption>
    </Card>}
    {splits.length > 1 && <Card title={txt("does_it_hold_up_on")} sub={txt("scenarios_are_split_60_20")} hint={txt("if_the_held_out_test")}>
      <div className="scroll"><table className="tbl"><thead><tr><th>{txt("set")}</th><th>{txt("scenarios")}</th><th>{txt("precision")}</th><th>{txt("recall")}</th><th>{txt("false_alarms_on_healthy_runs")}</th><th>{txt("early_warning_precision")}</th></tr></thead><tbody>
        {splits.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v.n}</td><td>{pct(v.precision, 1)}</td><td>{pct(v.recall, 1)}</td><td>{pct(v.false_positive_rate, 1)} <span className="muted small">{txt("n_n_clean", { n_clean: v.n_clean })}</span></td><td>{pct(v.risk_early_precision, 0)}</td></tr>)}</tbody></table></div>
      <Caption>{txt("the_detectors_were_written_and")}</Caption>
    </Card>}
  </>);
}
