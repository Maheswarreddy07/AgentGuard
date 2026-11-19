import { useState } from "react";
import { catLabel, fill, paths, useApi, useMeta, useT, useText } from "../api";
import { go } from "../router";
import MoreOnScroll from "../components/MoreOnScroll";
import { useTechnical } from "../hooks/technical";
import { Caption, Card, Empty, Info, Kpi, SevBadge, State, pct, sevColor, timeAgo } from "../ui";

function Score({ score, level, label }) {
  return <span className="gauge" aria-label={label}><span className="gauge-bar"><i style={{ width: score + "%", background: `var(--sev-${level}, var(--acc))` }} /></span><b>{score}</b></span>;
}

function RiskyRun({ r, tech }) {
  const meta = useMeta(), t = useText("risk"), [why, setWhy] = useState(false), p = r.prediction, act = p && meta.actions[p.recommended_action];
  return (
    <li className="risk-card" style={{ "--c": sevColor(p?.level) }}>
      <div className="rc-top">{p && <SevBadge sev={p.level} />}<b>{p ? catLabel(meta, p.predicted_failure) : r.task}</b><span className="muted small">{r.agent_name} · {timeAgo(r.updated_at)}</span></div>
      {p?.evidence[0] && <p className="rc-why">{p.evidence[0]}</p>}
      {act && <p className="rc-do">{t.suggested} <b>{act.icon} {act.label}</b></p>}
      <div className="row">
        <button className="btn primary sm" onClick={() => go("/traces/" + encodeURIComponent(r.trace_id))}>{t.look}</button>
        {p?.evidence.length > 1 && <button className="linkbtn" aria-expanded={why} onClick={() => setWhy(!why)}>{why ? t.why_hide : t.why_show}</button>}
        {tech && <span className="muted small mono">{r.trace_id} · {fill(t.level_score, { score: r.risk_score })}</span>}
      </div>
      {why && <ul className="plain small">{p.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </li>
  );
}

function Reliability({ m, tech }) {
  const meta = useMeta(), t = useText("risk"), preds = useApi(tech ? paths.riskPredictions({ limit: 30 }) : null), d = m.definitions ?? {}, [open, setOpen] = useState(null);
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t.kpi_right} value={pct(m.precision, 0)} sub={fill(t.kpi_right_sub, { resolved: m.n_resolved, pending: m.n_pending })} hint={d.precision} />
        <Kpi label={t.kpi_first} value={pct(m.recall, 0)} sub={fill(t.kpi_first_sub, { n: m.n_failures })} hint={d.recall} />
        <Kpi label={t.kpi_lead} value={m.avg_lead_steps == null ? t.kpi_lead_none : m.avg_lead_steps.toFixed(1) + " " + t.kpi_lead_unit} hint={d.lead} />
        <Kpi label={t.kpi_false} value={pct(m.false_intervention_rate, 0)} sub={fill(t.kpi_false_sub, { n: m.n_high_resolved })} hint={d.false_intervention} />
      </div>
      <Caption>{t.rule_based}</Caption>
      {tech && preds.data && (
        <Card title={t.history_title} sub={t.history_sub}>
          {preds.data.items.length === 0 ? <p className="muted">{t.history_empty}</p> : <div className="scroll"><table className="tbl"><thead><tr>{["score", "problem", "run", "step", "confidence", "result"].map((k) => <th key={k}>{t.cols[k]}</th>)}</tr></thead><tbody>
            {preds.data.items.map((p) => [
              <tr key={p.id} className="clickable" onClick={() => setOpen(open === p.id ? null : p.id)}><td><Score score={p.score} level={p.level} label={fill(t.score_label, { score: p.score })} /></td><td>{catLabel(meta, p.predicted_failure)}</td><td><a href={"#/traces/" + p.trace_id} className="mono">{p.trace_id}</a></td><td>{p.step_index}</td><td>{p.confidence}</td><td>{t.outcome[p.outcome] ?? p.outcome}</td></tr>,
              open === p.id && <tr key={p.id + "x"}><td colSpan={6}><div className="signals"><b>{t.built}</b><ul className="plain">{p.signals.map((s, i) => <li key={i}><b>+{s.points}</b> {s.detail}</li>)}</ul></div></td></tr>])}
          </tbody></table></div>}
        </Card>)}
    </div>
  );
}

/** Risk Monitor: the runs to look at first, in plain words. How reliable the warnings are is one click away. */
export default function Risk() {
  const t = useText("risk"), c = useText("common"), mon = useApi(paths.riskMonitor()), m = useApi(paths.riskMetrics), [tech, setTech] = useTechnical(), tt = useT("technical_details"), [more, setMore] = useState(false);
  return (
    <div className="stack">
      <div className="row"><p className="lead">{t.intro}</p><button className="linkbtn push" aria-pressed={tech} onClick={() => setTech(!tech)}>{tt("title")}</button></div>
      <State loading={mon.loading && !mon.data} error={mon.error} h={140} onRetry={mon.reload} />
      {mon.data && (mon.data.items.length === 0 ? <Empty title={t.empty_title} icon="✅"><p className="muted">{t.empty_body}</p></Empty> : (
        <MoreOnScroll items={mon.data.items}>{(rows) => <ul className="risklist">{rows.map((r) => <RiskyRun key={r.trace_id} r={r} tech={tech} />)}</ul>}</MoreOnScroll>))}
      {m.data && <div className="more-row"><span className="muted">{m.data.n_resolved ? fill(t.summary_some, { pct: pct(m.data.precision, 0) }) : t.summary_none}</span><button className="linkbtn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? t.reliability_hide : t.reliability_show}</button></div>}
      {more && m.data && <Reliability m={m.data} tech={tech} />}
    </div>
  );
}
