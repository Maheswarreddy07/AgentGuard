import { fill, useT, useText } from "../hooks/context";
import { timeAgo } from "../ui";
import ConfirmDelete from "./ConfirmDelete";

/** Delete button for an agent; explains what happens to its runs. */
export function AgentDelete({ agent, onDelete }) {
  const d = useText("delete");
  return <ConfirmDelete what={agent.runs ? d.agent : d.agent_empty} vars={{ name: agent.name, n: agent.runs }} onConfirm={() => onDelete(agent)} />;
}

/** Health verdict for an agent: [plain-language label, colour]. Wording comes from the server's agents text `t`. */
export const agentHealth = (a, t = {}) => {
  const h = t.health ?? {};
  return a.runs === 0 ? [h.none, "var(--mut)"] : a.flagged_runs / a.runs >= 0.5 ? [h.attention, "var(--bad)"] : a.flagged_runs > 0 ? [h.some, "var(--warn)"] : [h.ok, "var(--good)"];
};
const CONNECTION_COLOR = { connected: "var(--good)", quiet: "var(--warn)", test_only: "var(--warn)", waiting: "var(--mut)" };

/** One agent: how it is connected, whether it is sending runs, what it did lately and what problems are open. */
export default function AgentCard({ agent, onOpen, onDelete }) {
  const t = useText("agents"), tt = useT("technical_details"), conn = t.connection?.[agent.connection] ?? {}, [verdict, color] = agentHealth(agent, t);
  return (
    <div className="agent-card" style={{ "--c": CONNECTION_COLOR[agent.connection] ?? color }}>
      <button className="agent-open" onClick={() => onOpen(agent)} aria-label={fill(t.open_label, { name: agent.name })}>
        <span className="scn-top"><b>{agent.name}</b><span className="badge sev" style={{ "--c": CONNECTION_COLOR[agent.connection] }} title={fill(conn.hint, { days: agent.quiet_after_days })}>{conn.label}</span></span>
        <span className="row small"><span className="badge sev" style={{ "--c": color }}>{verdict}</span><span className="muted">{agent.last_seen_at ? fill(t.last_seen, { when: timeAgo(agent.last_seen_at) }) : t.never_seen}</span></span>
        {agent.description && <span className="muted small">{agent.description}</span>}
        <span className="muted small">{t.integration_label}: <b>{t.integration?.[agent.integration ?? "none"]}</b></span>
        <span className="agent-stats"><span><b>{agent.runs}</b> {t.stats?.runs}</span><span className={agent.open_serious ? "bad" : ""}>{agent.open_problems ? fill(t.problems_open, { n: agent.open_problems }) : t.problems_none}{agent.open_serious > 0 && <> · <b>{fill(t.serious, { n: agent.open_serious })}</b></>}</span></span>
        <span className="agent-recent"><span className="nav-h">{t.recent}</span>
          {agent.recent_activity?.length ? <ul className="plain small">{agent.recent_activity.map((r) => <li key={r.trace_id}>{r.headline || r.trace_id} <span className="muted">· {timeAgo(r.at)}</span></li>)}</ul> : <span className="muted small">{t.recent_none}</span>}</span>
      </button>
      <details className="tech agent-tech"><summary>{tt("title")}</summary><span className="muted small mono">{agent.environment} · {agent.name} · {agent.integration ?? "none"}</span></details>
      {onDelete && <div className="agent-foot"><AgentDelete agent={agent} onDelete={onDelete} /></div>}
    </div>
  );
}
