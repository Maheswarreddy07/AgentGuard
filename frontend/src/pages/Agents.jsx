import { useState } from "react";
import { paths, useApi } from "../api";
import { go } from "../router";
import AgentCard from "../components/AgentCard";
import AgentTable from "../components/AgentTable";
import EmptyState from "../components/EmptyState";
import { Card, Chip, State } from "../ui";

export default function Agents() {
  const list = useApi(paths.agents), [view, setView] = useState("cards");
  const open = (a) => go("/traces", { agent: a.name });
  if (!list.data) return <State loading={list.loading} error={list.error} h={200} onRetry={list.reload} />;
  const agents = list.data.items;
  if (agents.length === 0) return <EmptyState icon="🤖" title="No agents yet" action={<button className="btn primary" onClick={() => go("/integrations")}>Connect your first agent</button>}><p className="muted">An agent appears here automatically the first time it sends a run.</p></EmptyState>;
  return (
    <div className="stack">
      <Card title={`${agents.length} agent${agents.length === 1 ? "" : "s"}`} sub="Click an agent to see its runs"
        right={<div className="row"><Chip active={view === "cards"} onClick={() => setView("cards")}>Cards</Chip><Chip active={view === "table"} onClick={() => setView("table")}>Table</Chip><button className="btn primary" onClick={() => go("/integrations")}>＋ Connect an agent</button></div>}>
        {view === "cards" ? <div className="scn-grid">{agents.map((a) => <AgentCard key={a.id} agent={a} onOpen={open} />)}</div> : <AgentTable agents={agents} onOpen={open} />}
      </Card>
    </div>
  );
}
