import { useEffect, useState } from "react";
import { api, useApi, useAuth } from "../api";
import { Caption, Card, Chip, Empty, State, timeAgo, useToast, when } from "../ui";
const STATUS = { pending: ["Waiting for a decision", "var(--warn)"], approved: ["Approved", "var(--good)"], rejected: ["Rejected", "var(--bad)"], changes_requested: ["Changes requested", "var(--warn)"], expired: ["Expired", "var(--mut)"] };

function Request({ a, onDone }) {
  const { can } = useAuth(), toast = useToast(), [note, setNote] = useState(""), [busy, setBusy] = useState(false), ev = useApi(a.status === "pending" ? `/api/v1/approvals/${a.id}` : null);
  async function decide(decision) {
    setBusy(true);
    try { await api(`/api/v1/approvals/${a.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note }) }); toast(decision === "approve" ? "Approved. The agent can now run this action once." : "Decision recorded."); onDone(); }
    catch (e) { toast(e.message, "bad"); } finally { setBusy(false); }
  }
  const st = STATUS[a.status] ?? [a.status, "var(--mut)"];
  return (
    <article className="approval" style={{ "--c": st[1] }}>
      <div className="row"><b>{a.tool_name}</b><span className="badge sev" style={{ "--c": st[1] }}>{st[0]}</span><span className="muted small">requested by <b>{a.agent_name}</b> in <a href={"#/traces/" + a.trace_id} className="mono">{a.trace_id}</a> · {timeAgo(a.created_at)}</span></div>
      <p><b>Why a person is needed:</b> {a.reason}</p>
      <div className="cols"><div><h4>What the agent wants to run</h4><pre>{JSON.stringify(a.arguments, null, 1)}</pre></div>
        {ev.data?.evidence?.length > 0 && <div><h4>What it did just before</h4><ul className="plain small">{ev.data.evidence.map((e) => <li key={e.event_id}>step {e.step_index}: {e.event_type.replace(/_/g, " ")}{e.tool_name ? ` · ${e.tool_name}` : ""}{e.status === "error" ? " (error)" : ""}</li>)}</ul></div>}</div>
      {a.status === "pending" ? (can("member") ? (<>
        <label className="field">Note (required to reject or ask for changes)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer is under review" /></label>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => decide("approve")}>Approve once</button><button className="btn" disabled={busy || !note.trim()} onClick={() => decide("reject")}>Reject</button><button className="btn" disabled={busy || !note.trim()} onClick={() => decide("request_changes")}>Ask for changes</button>
          <span className="muted small">Expires {when(a.expires_at)} — if nobody answers it is treated as rejected.</span></div></>) : <p className="muted">Only members and admins can decide.</p>)
        : <p className="muted small">{a.decided_by ? `Decided by ${a.decided_by} · ${when(a.decided_at)}` : "No decision was made."}{a.decision_note ? ` — “${a.decision_note}”` : ""}{a.status === "approved" ? (a.consumed ? " · used" : " · not used yet") : ""}</p>}
    </article>
  );
}

export default function Approvals() {
  const [status, setStatus] = useState("pending"), list = useApi(`/api/v1/approvals?limit=50${status ? `&status=${status}` : ""}`);
  useEffect(() => { const t = setInterval(list.reload, 8000); return () => clearInterval(t); }, [list.reload]);
  return (
    <div className="stack">
      <Card title="Human approvals" sub="Actions an agent is not allowed to take on its own. The agent waits here until you decide.">
        <div className="chips">{[["pending", "Waiting"], ["", "Everything"], ["approved", "Approved"], ["rejected", "Rejected"], ["changes_requested", "Changes requested"], ["expired", "Expired"]].map(([k, l]) => <Chip key={l} active={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}</div>
        <Caption>An approval lets the agent run exactly this action, with exactly these inputs, once. It can never override a rule that says BLOCK. This page refreshes by itself.</Caption>
      </Card>
      <State loading={list.loading && !list.data} error={list.error} h={160} />
      {list.data && (list.data.items.length === 0 ? <Empty title={status === "pending" ? "Nothing is waiting for you" : "Nothing here"} icon="✅" /> : list.data.items.map((a) => <Request key={a.id} a={a} onDone={list.reload} />))}
    </div>
  );
}
