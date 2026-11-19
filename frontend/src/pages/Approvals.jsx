import { useState } from "react";
import { approvalApi, paths, useApi, useAuth, usePolling } from "../api";
import ApprovalCard, { APPROVAL_STATUS } from "../components/ApprovalCard";
import EmptyState from "../components/EmptyState";
import { Caption, Card, Chip, State, useToast } from "../ui";
import { useT } from "../hooks/context";

/** One approval. Pending ones also load the run's recent steps as evidence. */
function ApprovalItem({ approval, onDone }) {
  const txt = useT("approvals");
  const { allowed } = useAuth(), toast = useToast(), [busy, setBusy] = useState(false);
  const detail = useApi(approval.status === "pending" ? paths.approval(approval.id) : null);
  async function decide(decision, note) {
    setBusy(true);
    try { await approvalApi.decide(approval.id, decision, note); toast(decision === "approve" ? txt("approved_the_agent_can_now") : txt("decision_recorded")); onDone(); }
    catch (e) { toast(e.message, "bad"); } finally { setBusy(false); }
  }
  return <ApprovalCard approval={approval} evidence={detail.data?.evidence ?? []} canDecide={allowed("decide_approvals")} busy={busy} onDecide={decide} />;
}

export default function Approvals() {
  const txt = useT("approvals");
  const [status, setStatus] = useState("pending"), list = useApi(paths.approvals({ limit: 50, status }));
  usePolling(list.reload, 8000);
  return (
    <div className="stack">
      <Card title={txt("human_approvals")} sub={txt("actions_an_agent_is_not")}>
        <div className="chips">{[["pending", txt("chip_waiting")], ["", txt("chip_everything")], ...["approved", "rejected", "changes_requested", "expired"].map((k) => [k, txt(APPROVAL_STATUS[k][0])])].map(([k, l]) => <Chip key={k} active={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}</div>
        <Caption>{txt("an_approval_lets_the_agent")}</Caption>
      </Card>
      <State loading={list.loading && !list.data} error={list.error} h={160} onRetry={list.reload} />
      {list.data && (list.data.items.length === 0 ? <EmptyState title={status === "pending" ? txt("nothing_is_waiting_for_you") : txt("nothing_here")} icon="✅" /> : list.data.items.map((a) => <ApprovalItem key={a.id} approval={a} onDone={list.reload} />))}
    </div>
  );
}
