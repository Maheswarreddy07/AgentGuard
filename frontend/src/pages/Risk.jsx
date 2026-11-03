import { useState } from "react";
import { api, catLabel, useApi, useMeta } from "../api";
import { Caption, Card, Empty, Info, Kpi, State, SevBadge, pct, timeAgo } from "../ui";
const OUT = { occurred: ["✓ came true", "var(--good)"], not_occurred: ["✗ did not happen", "var(--bad)"], pending: ["… run still going", "var(--mut)"] };

function Score({ score, level }) {
  return <span className="gauge" aria-label={`Risk ${score} of 100`}><span className="gauge-bar"><i style={{ width: score + "%", background: `var(--sev-${level}, var(--acc))` }} /></span><b>{score}</b></span>;
}

export default function Risk() {
  const meta = useMeta(), mon = useApi("/api/v1/risk/monitor"), m = useApi("/api/v1/risk/metrics"), preds = useApi("/api/v1/risk/predictions?limit=30");
  const [open, setOpen] = useState(null);
  const d = m.data?.definitions ?? {};
  return (
    <div className="stack">
      <Card title="How good are the warnings?" sub="Measured on stored runs: each warning is later checked against what actually happened" right={<span className="badge">live data</span>}>
        {m.data && (m.data.n_predictions === 0 ? <p className="muted">No warnings have been raised yet. Warnings appear when a run’s trajectory looks risky, e.g. repeated failures or an action about to break a rule.</p> : (
          <div className="kpis">
            <Kpi label="Warnings that came true" value={pct(m.data.precision, 0)} sub={`${m.data.n_resolved} resolved · ${m.data.n_pending} still pending`} hint={d.precision} />
            <Kpi label="Failures warned about first" value={pct(m.data.recall, 0)} sub={`${m.data.n_failures} failures`} hint={d.recall} />
            <Kpi label="Average head start" value={m.data.avg_lead_steps == null ? "n/a" : m.data.avg_lead_steps.toFixed(1) + " steps"} sub={m.data.warned_before_failure == null ? "" : pct(m.data.warned_before_failure, 0) + " came earlier than the failing step"} hint={d.lead} />
            <Kpi label="Needless alarms" value={pct(m.data.false_intervention_rate, 0)} sub={`of ${m.data.n_high_resolved} high/critical warnings`} hint={d.false_intervention} />
          </div>))}
        <State loading={m.loading && !m.data} error={m.error} h={100} />
        <Caption>This is a transparent, rule-based score — not a trained model. Small sample sizes are shown next to every number; treat early numbers with care.</Caption>
      </Card>

      <Card title="Runs that look risky right now" sub={mon.data ? `Risk score ${mon.data.threshold} or higher (adjustable in Settings)` : ""}>
        <State loading={mon.loading && !mon.data} error={mon.error} h={140} />
        {mon.data && (mon.data.items.length === 0 ? <Empty title="No risky runs" icon="✅"><p className="muted">Nothing is above the warning threshold.</p></Empty> : (
          <ul className="risklist">{mon.data.items.map((r) => (
            <li key={r.trace_id} className="riskrow">
              <div className="riskrow-top"><a href={"#/traces/" + r.trace_id} className="mono">{r.trace_id}</a><span className="badge">{r.outcome}</span>{r.mode && <span className="badge">{r.mode} mode</span>}<span className="muted small">{r.agent_name}{r.task ? ` · ${r.task}` : ""} · {timeAgo(r.updated_at)}</span></div>
              {r.prediction && <>
                <div className="riskrow-mid"><Score score={r.risk_score} level={r.prediction.level} /><SevBadge sev={r.prediction.level} /><b>{catLabel(meta, r.prediction.predicted_failure)}</b><span className="muted">→ suggested: {meta.actions[r.prediction.recommended_action]?.label ?? r.prediction.recommended_action}</span></div>
                <ul className="plain small">{r.prediction.evidence.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}</ul></>}
            </li>))}</ul>))}
      </Card>

      <Card title="Warning history" sub="Every warning, and whether it turned out to be right" hint="Click a row to see exactly which signals added up to the score.">
        <State loading={preds.loading && !preds.data} error={preds.error} h={120} />
        {preds.data && preds.data.items.length === 0 && <p className="muted">Nothing recorded yet.</p>}
        {preds.data && preds.data.items.length > 0 && <div className="scroll"><table className="tbl"><thead><tr><th>Score</th><th>Predicted problem</th><th>Run</th><th>Step</th><th>Confidence <Info text="How many independent signals agreed: 1 = low, 2 = medium, 3 or more = high. An ordinal label, not a probability." /></th><th>What happened</th></tr></thead><tbody>
          {preds.data.items.map((p) => [
            <tr key={p.id} className="clickable" onClick={() => setOpen(open === p.id ? null : p.id)}><td><Score score={p.score} level={p.level} /></td><td>{catLabel(meta, p.predicted_failure)}</td><td><a href={"#/traces/" + p.trace_id} className="mono">{p.trace_id}</a></td><td>{p.step_index}</td><td>{p.confidence}</td>
              <td style={{ color: OUT[p.outcome]?.[1] }}>{OUT[p.outcome]?.[0] ?? p.outcome}{p.lead_steps != null ? ` (${p.lead_steps} step${p.lead_steps === 1 ? "" : "s"} ahead)` : ""}</td></tr>,
            open === p.id && <tr key={p.id + "x"}><td colSpan={6}><div className="signals"><b>How this score was built</b><ul className="plain">{p.signals.map((s, i) => <li key={i}><b>+{s.points}</b> {s.detail} <span className="muted small">({s.name.replace(/_/g, " ")})</span></li>)}</ul></div></td></tr>])}
        </tbody></table></div>}
      </Card>
    </div>
  );
}
