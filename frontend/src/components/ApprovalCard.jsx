import { useState } from "react";
import { timeAgo, when } from "../ui";
import TechnicalDetails from "./TechnicalDetails";

export const APPROVAL_STATUS = { pending: ["Waiting for a decision", "var(--warn)"], approved: ["Approved", "var(--good)"], rejected: ["Rejected", "var(--bad)"], changes_requested: ["Changes requested", "var(--warn)"], expired: ["Expired", "var(--mut)"] };

/** A request from an agent to do something that needs a person's OK. onDecide(decision, note) is supplied by the page. */
export default function ApprovalCard({ approval: a, evidence = [], canDecide, busy, onDecide }) {
  const [note, setNote] = useState("");
  const st = APPROVAL_STATUS[a.status] ?? [a.status, "var(--mut)"];
  return (
    <article className="approval" style={{ "--c": st[1] }}>
      <div className="row"><b>{a.tool_name}</b><span className="badge sev" style={{ "--c": st[1] }}>{st[0]}</span><span className="muted small">requested by <b>{a.agent_name}</b> in <a href={"#/traces/" + a.trace_id} className="mono">{a.trace_id}</a> · {timeAgo(a.created_at)}</span></div>
      <p><b>Why a person is needed:</b> {a.reason}</p>
      <div className="cols">
        <div><h4>What the agent wants to run</h4><pre>{JSON.stringify(a.arguments, null, 1)}</pre></div>
        {evidence.length > 0 && <div><h4>What it did just before</h4><ul className="plain small">{evidence.map((e) => <li key={e.event_id}>step {e.step_index}: {e.event_type.replace(/_/g, " ")}{e.tool_name ? ` · ${e.tool_name}` : ""}{e.status === "error" ? " (error)" : ""}</li>)}</ul></div>}
      </div>
      {evidence.length > 0 && <TechnicalDetails data={evidence} />}
      {a.status === "pending" ? (canDecide ? (<>
        <label className="field">Note (required to reject or ask for changes)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer is under review" /></label>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => onDecide("approve", note)}>Approve once</button>
          <button className="btn" disabled={busy || !note.trim()} onClick={() => onDecide("reject", note)}>Reject</button>
          <button className="btn" disabled={busy || !note.trim()} onClick={() => onDecide("request_changes", note)}>Ask for changes</button>
          <span className="muted small">Expires {when(a.expires_at)} — if nobody answers it is treated as rejected.</span>
        </div></>) : <p className="muted">Only members and admins can decide.</p>)
        : <p className="muted small">{a.decided_by ? `Decided by ${a.decided_by} · ${when(a.decided_at)}` : "No decision was made."}{a.decision_note ? ` — “${a.decision_note}”` : ""}{a.status === "approved" ? (a.consumed ? " · used" : " · not used yet") : ""}</p>}
    </article>
  );
}
