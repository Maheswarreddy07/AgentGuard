import { timeAgo } from "../ui";

/** Health verdict for an agent in plain words. */
export const agentHealth = (a) => (a.runs === 0 ? ["No runs yet", "var(--mut)"] : a.flagged_runs / a.runs >= 0.5 ? ["Needs attention", "var(--bad)"] : a.flagged_runs > 0 ? ["Some problems", "var(--warn)"] : ["Healthy", "var(--good)"]);

export default function AgentCard({ agent, onOpen }) {
  const [verdict, color] = agentHealth(agent);
  return (
    <button className="agent-card" style={{ "--c": color }} onClick={() => onOpen(agent)} aria-label={`Open runs of ${agent.name}`}>
      <span className="scn-top"><b>{agent.name}</b><span className="badge sev" style={{ "--c": color }}>{verdict}</span></span>
      {agent.description && <span className="muted small">{agent.description}</span>}
      <span className="agent-stats">
        <span><b>{agent.runs}</b> runs</span><span><b>{agent.flagged_runs}</b> flagged</span><span><b>{agent.blocked_actions}</b> blocked</span><span>risk <b>{agent.avg_risk ?? "–"}</b></span>
      </span>
      <span className="muted small">{agent.environment} · {agent.last_seen_at ? "last seen " + timeAgo(agent.last_seen_at) : "never seen"}</span>
    </button>
  );
}
