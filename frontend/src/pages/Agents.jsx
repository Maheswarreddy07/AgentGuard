import { agentApi, fill, paths, useApi, useAuth, useText } from "../api";
import { go } from "../router";
import AgentCard from "../components/AgentCard";
import EmptyState from "../components/EmptyState";
import { Card, State } from "../ui";

export default function Agents() {
  const t = useText("agents"), { allowed } = useAuth(), list = useApi(paths.agents);
  const open = (a) => go("/traces", { agent: a.name });
  if (!list.data) return <State loading={list.loading} error={list.error} h={200} onRetry={list.reload} />;
  const agents = list.data.items, onDelete = allowed("delete_data") ? async (a) => { await agentApi.remove(a.name, true); list.reload(); } : undefined;
  if (agents.length === 0) return <EmptyState icon="🤖" title={t.empty_title} action={<button className="btn primary" onClick={() => go("/integrations")}>{t.empty_cta}</button>}><p className="muted">{t.empty_body}</p></EmptyState>;
  return (
    <div className="stack">
      <Card title={agents.length === 1 ? t.count_one : fill(t.count_many, { n: agents.length })} sub={t.sub}
        right={<div className="row"><button className="btn primary" onClick={() => go("/integrations")}>{t.connect}</button></div>}>
        <div className="scn-grid">{agents.map((a) => <AgentCard key={a.id} agent={a} onOpen={open} onDelete={onDelete} />)}</div>
      </Card>
    </div>
  );
}
