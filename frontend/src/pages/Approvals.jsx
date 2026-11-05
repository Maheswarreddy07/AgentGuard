import { useState } from "react";
import { approvalApi, paths, useApi, useAuth, usePolling } from "../api";
import ApprovalCard from "../components/ApprovalCard";
import EmptyState from "../components/EmptyState";
import { Caption, Card, Chip, State, useToast } from "../ui";

/** One approval. Pending ones also load the run's recent steps as evidence. */
function ApprovalItem({ approval, onDone }) {
  const { can } = useAuth(), toast = useToast(), [busy, setBusy] = useState(false);
  const detail = useApi(approval.status === "pending" ? paths.approval(approval.id) : null);
  async function decide(decision, note) {
    setBusy(true);
    try { await approvalApi.decide(approval.id, decision, note); toast(decision === "approve" ? "Approved. The agent can now run this action once." : "Decision recorded."); onDone(); }
    catch (e) { toast(e.message, "bad"); } finally { setBusy(false); }
  }
  return <ApprovalCard approval={approval} evidence={detail.data?.evidence ?? []} canDecide={can("member")} busy={busy} onDecide={decide} />;
}

export default function Approvals() {
  const [status, setStatus] = useState("pending"), list = useApi(paths.approvals({ limit: 50, status }));
  usePolling(list.reload, 8000);
  return (
    <div className="stack">
      <Card title="Human approvals" sub="Actions an agent is not allowed to take on its own. The agent waits here until you decide.">
        <div className="chips">{[["pending", "Waiting"], ["", "Everything"], ["approved", "Approved"], ["rejected", "Rejected"], ["changes_requested", "Changes requested"], ["expired", "Expired"]].map(([k, l]) => <Chip key={l} active={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}</div>
        <Caption>An approval lets the agent run exactly this action, with exactly these inputs, once. It can never override a rule that says BLOCK. This page refreshes by itself.</Caption>
      </Card>
      <State loading={list.loading && !list.data} error={list.error} h={160} onRetry={list.reload} />
      {list.data && (list.data.items.length === 0 ? <EmptyState title={status === "pending" ? "Nothing is waiting for you" : "Nothing here"} icon="✅" /> : list.data.items.map((a) => <ApprovalItem key={a.id} approval={a} onDone={list.reload} />))}
    </div>
  );
}
