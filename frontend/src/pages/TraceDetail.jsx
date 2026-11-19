import { useState } from "react";
import { paths, runApi, useApi, useAuth, useMeta } from "../api";
import ConfirmDelete from "../components/ConfirmDelete";
import ProblemDetails from "../components/ProblemDetails";
import { go } from "../router";
import TechnicalDetails from "../components/TechnicalDetails";
import Flow, { Inspector } from "../components/Flow";
import { Card, GOOD, Info, Kpi, SevBadge, State, BAD, sevColor } from "../ui";
import { useT } from "../hooks/context";

const OUT = { recovered: ["✅", "o_recovered", GOOD], escalated: ["⚠️", "o_escalated", "var(--warn)"], stopped: ["⛔", "o_stopped", BAD], none: ["•", "o_none", "var(--mut)"] };

function Recovery({ id, reload }) {
  const txt = useT("trace_detail");
  const { allowed } = useAuth();
  const plan = useApi(paths.recoveryPlan(id));
  const [sim, setSim] = useState({ transient_fail_count: 1, corrected_args_valid: true, evidence_available: true });
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  async function run() {
    setBusy(true); setErr(null);
    try { setRes(await runApi.recover(id, sim)); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  if (plan.loading || plan.error) return <State loading={plan.loading} error={plan.error} h={90} />;
  const p = plan.data, o = res && OUT[res.outcome.terminal];
  return (
    <Card title={txt("what_is_safe_to_do")} hint={txt("agentguard_only_ever_previews_or")}>
      <div className="plan"><div className="plan-a">{p.action_label}</div><p>{p.plain}</p><p className="muted">{txt("why_reason", { reason: p.reason })}</p></div>
      {p.action !== "none" && (
        <div className="simbox">
          <h4>{txt("try_it_in_a_simulated")}</h4>
          {p.action === "retry" && <label className="field">{txt("how_many_retries_will_still")}<select value={sim.transient_fail_count} onChange={(e) => setSim({ ...sim, transient_fail_count: +e.target.value })}>{[0, 1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}{n >= 3 ? txt("exceeds_the_limit_of_3") : ""}</option>)}</select></label>}
          {p.action === "correct_args" && <label className="check"><input type="checkbox" checked={sim.corrected_args_valid} onChange={(e) => setSim({ ...sim, corrected_args_valid: e.target.checked })} />{txt("the_corrected_arguments_turn_out")}</label>}
          {p.action === "request_evidence" && <label className="check"><input type="checkbox" checked={sim.evidence_available} onChange={(e) => setSim({ ...sim, evidence_available: e.target.checked })} />{txt("the_missing_evidence_is_available")}</label>}
          {["escalate", "stop"].includes(p.action) && <p className="muted">{txt("this_outcome_never_depends_on")}</p>}
          <button className="btn primary" disabled={busy || !allowed("run_recovery")} title={allowed("run_recovery") ? "" : txt("members_and_admins_can_run")} onClick={run}>{busy ? txt("simulating") : txt("run_simulation")}</button>{!allowed("ask_ai_diagnosis") && <span className="muted small">{txt("viewers_can_read_the_plan")}</span>}
          {err && <p role="alert" className="alert">{err}</p>}
          {res && <div className="outcome" style={{ "--c": o[2] }} role="status"><span className="big">{o[0]}</span><div><b>{txt(o[1])}</b><div className="muted">{res.outcome.attempts ? txt("attempts_attempt_s", { attempts: res.outcome.attempts }) : ""}{res.note}</div></div></div>}
        </div>)}
    </Card>
  );
}

function AiCard({ id }) {
  const txt = useT("trace_detail");
  const { allowed } = useAuth();
  const [ai, setAi] = useState(null), [busy, setBusy] = useState(false);
  async function ask() { setBusy(true); try { setAi((await runApi.analyze(id)).ai_diagnosis); } catch (e) { setAi({ status: "error", error: e.message }); } finally { setBusy(false); } }
  return (
    <Card title={txt("ai_second_opinion_optional")} hint={txt("a_language_model_reads_only")}>
      <button className="btn" disabled={busy || !allowed("ask_ai_diagnosis")} onClick={ask}>{busy ? txt("asking") : txt("ask_the_ai_to_explain")}</button>
      {ai && (ai.status === "ok" ? (
        <div className="ai"><span className="badge">{txt("ai_hypothesis_not_proven")}</span><p>{ai.diagnosis.summary}</p><p><b>{txt("likely_cause")}</b> {ai.diagnosis.likely_explanation}</p>
          <p><b>{txt("cited_steps")}</b> {ai.diagnosis.supporting_evidence_event_ids.join(", ")} · <b>{txt("confidence")}</b> {ai.diagnosis.confidence} · {ai.diagnosis.needs_human_review ? txt("human_review_recommended") : txt("no_review_flagged")}</p><p className="muted">{txt("limits_limitations", { limitations: ai.diagnosis.limitations })}</p></div>
      ) : <p role="status" className="muted">{ai.status === "disabled" ? txt("ai_diagnosis_isn_t_configured") : txt("ai_diagnosis_unavailable_status", { status: ai.status })}</p>)}
    </Card>
  );
}

export default function TraceDetail({ id }) {
  const { allowed } = useAuth();
  const txt = useT("trace_detail");
  const meta = useMeta();
  const t = useApi(paths.trace(id)), a = useApi(paths.analysis(id));
  const [sel, setSel] = useState(null);
  if (!t.data || !a.data) return <><a className="back" href="#/traces">{txt("all_traces")}</a><State loading={t.loading || a.loading} error={t.error || a.error} h={300} /></>;
  const events = t.data.events, A = a.data, loc = A.localization;
  const markers = {};
  [[loc.origin_event_id, txt("mk_origin")], [loc.first_detectable_event_id, txt("mk_first")], [loc.observed_event_id, txt("mk_observed")]].forEach(([eid, m]) => { if (eid) (markers[eid] ??= []).push(m); });
  const evidence = new Set(A.findings.flatMap((f) => f.evidence_event_ids));
  const reload = () => { t.reload(); a.reload(); };
  return (
    <div className="stack">
      <a className="back" href="#/traces">{txt("all_traces")}</a>
      <Card className="summary" >
        <div className="row"><h2 className="mono">{id}</h2><SevBadge sev={A.summary.max_severity} /><span className="badge">{txt("length_steps", { length: events.length })}</span>{allowed("delete_data") && <span className="push"><ConfirmDelete kind="run" vars={{ name: id }} onConfirm={() => runApi.remove(id)} onDone={() => go("/traces")} /></span>}</div>
        <p className="lead">{A.summary.headline}</p>
      </Card>

      <div className="kpis">
        <Kpi label={txt("outcome")} value={t.data.outcome} sub={t.data.mode ? txt("mode_mode_v2", { mode: t.data.mode, v2: t.data.environment ?? "no environment" }) : undefined} />
        <Kpi label={txt("risk_score")} value={t.data.risk_score} sub={txt("highest_reached")} tone={t.data.risk_score >= 50 ? BAD : undefined} />
        <Kpi label={txt("actions_blocked")} value={t.data.blocked_actions} tone={t.data.blocked_actions ? BAD : undefined} />
        <Kpi label={txt("tool_calls")} value={t.data.tool_calls} sub={t.data.duration_ms == null ? txt("still_running") : txt("v1_s", { v1: (t.data.duration_ms / 1000).toFixed(1) })} />
        <Kpi label={txt("tokens_cost")} value={t.data.tokens} sub={`$${t.data.cost_usd.toFixed(4)}`} />
      </div>
      {t.data.task && <p className="muted">{txt("task_given_to_the_agent")} <b>{t.data.task}</b></p>}

      <Card title={txt("what_happened")} hint={txt("each_box_is_one_step")}>
        <Flow events={events} markers={markers} evidence={evidence} selected={sel} onSelect={setSel} />
        {loc.resolved ? (
          <div className="legend-row">
            <span><span className="mark m-origin">{txt("origin")}</span> {txt("where_the_problem_started")}{loc.origin_event_id ? "" : txt("not_determinable_from_the_recorded")}</span>
            <span><span className="mark m-first">{txt("first_detectable")}</span> {txt("earliest_step_at_which_a")}</span>
            <span><span className="mark m-observed">{txt("observed")}</span> {txt("last_step_that_shows_it")}</span>
          </div>
        ) : <p className="muted">{txt("no_failure_to_localize")}</p>}
        <Inspector event={events.find((e) => e.event_id === sel)} findings={A.findings} />
      </Card>

      <Card title={txt("findings_length", { length: A.findings.length })} hint={txt("each_finding_comes_from_an")}>
        {A.findings.length === 0 ? <p className="muted">{txt("no_rule_found_a_problem")}</p> : A.findings.map((f) => <ProblemDetails key={f.id} problem={f} selectedEventId={sel} onSelectEvent={setSel} stepOf={(eid) => events.find((e) => e.event_id === eid)?.step_index} />)}
      </Card>

      {events.some((e) => e.event_type === "policy_check") && <Card title={txt("policy_decisions")} sub={txt("each_check_happened_before_the")}>
        <ul className="plain">{events.filter((e) => e.event_type === "policy_check").map((e) => <li key={e.event_id}><button className="linkbtn" onClick={() => setSel(e.event_id)}>{txt("step_step_index", { step_index: e.step_index })}</button> <b>{e.tool_name}</b>: <span className="badge sev" style={{ "--c": e.metadata.effective === "ALLOW" ? GOOD : BAD }}>{e.metadata.effective.replace(/_/g, " ")}</span>
          {e.metadata.mode !== "enforce" && <span className="muted small"> {txt("mode_mode", { mode: e.metadata.mode })}{e.metadata.decision !== e.metadata.effective ? txt("enforce_mode_would_have_said", { v1: e.metadata.decision.replace(/_/g, " ") }) : ""})</span>} <span className="muted">{e.metadata.reason}</span></li>)}</ul></Card>}
      {events.some((e) => e.event_type === "risk_detected") && <Card title={txt("risk_warnings")} sub={txt("predicted_before_the_action_ran")}>
        {events.filter((e) => e.event_type === "risk_detected").map((e) => <article key={e.event_id} className="finding" style={{ "--c": sevColor(e.metadata.level) }}><div className="row"><b>{txt("score_score", { score: e.metadata.score })}</b><SevBadge sev={e.metadata.level} /><span className="badge">{txt("predicted_not_confirmed")}</span></div>
          <ul className="plain small">{e.metadata.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></article>)}</Card>}

      <TechnicalDetails title={txt("technical_details_every_recorded_event")} data={events} />
      <Recovery id={id} reload={reload} />
      <AiCard id={id} />
    </div>
  );
}
