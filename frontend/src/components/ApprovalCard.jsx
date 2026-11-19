import { useState } from "react";
import { timeAgo, when } from "../ui";
import TechnicalDetails from "./TechnicalDetails";
import { useT } from "../hooks/context";

export const APPROVAL_STATUS = { pending: ["status_pending", "var(--warn)"], approved: ["status_approved", "var(--good)"], rejected: ["status_rejected", "var(--bad)"], changes_requested: ["status_changes_requested", "var(--warn)"], expired: ["status_expired", "var(--mut)"] };

/** A request from an agent to do something that needs a person's OK. onDecide(decision, note) is supplied by the page. */
export default function ApprovalCard({ approval: a, evidence = [], canDecide, busy, onDecide }) {
  const txt = useT("approval_card");
  const [note, setNote] = useState("");
  const st0 = APPROVAL_STATUS[a.status], st = st0 ? [txt(st0[0]), st0[1]] : [a.status, "var(--mut)"];
  return (
    <article className="approval" style={{ "--c": st[1] }}>
      <div className="row"><b>{a.tool_name}</b><span className="badge sev" style={{ "--c": st[1] }}>{st[0]}</span><span className="muted small">{txt("requested_by")} <b>{a.agent_name}</b> {txt("in")} <a href={"#/traces/" + a.trace_id} className="mono">{a.trace_id}</a> · {timeAgo(a.created_at)}</span></div>
      <p><b>{txt("why_a_person_is_needed")}</b> {a.reason}</p>
      <div className="cols">
        <div><h4>{txt("what_the_agent_wants_to")}</h4><pre>{JSON.stringify(a.arguments, null, 1)}</pre></div>
        {evidence.length > 0 && <div><h4>{txt("what_it_did_just_before")}</h4><ul className="plain small">{evidence.map((e) => <li key={e.event_id}>{txt("step_step_index", { step_index: e.step_index })} {e.event_type.replace(/_/g, " ")}{e.tool_name ? ` · ${e.tool_name}` : ""}{e.status === "error" ? txt("error") : ""}</li>)}</ul></div>}
      </div>
      {evidence.length > 0 && <TechnicalDetails data={evidence} />}
      {a.status === "pending" ? (canDecide ? (<>
        <label className="field">{txt("note_required_to_reject_or")}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={txt("e_g_customer_is_under")} /></label>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => onDecide("approve", note)}>{txt("approve_once")}</button>
          <button className="btn" disabled={busy || !note.trim()} onClick={() => onDecide("reject", note)}>{txt("reject")}</button>
          <button className="btn" disabled={busy || !note.trim()} onClick={() => onDecide("request_changes", note)}>{txt("ask_for_changes")}</button>
          <span className="muted small">{txt("expires")} {when(a.expires_at)} {txt("if_nobody_answers_it_is")}</span>
        </div></>) : <p className="muted">{txt("only_members_and_admins_can")}</p>)
        : <p className="muted small">{a.decided_by ? txt("decided_by_decided_by_v2", { decided_by: a.decided_by, v2: when(a.decided_at) }) : txt("no_decision_was_made")}{a.decision_note ? ` — “${a.decision_note}”` : ""}{a.status === "approved" ? (a.consumed ? txt("used") : txt("not_used_yet")) : ""}</p>}
    </article>
  );
}
