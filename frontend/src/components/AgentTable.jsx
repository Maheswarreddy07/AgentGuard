import { useText } from "../hooks/context";
import { AgentDelete, agentHealth } from "./AgentCard";
import { timeAgo } from "../ui";

export default function AgentTable({ agents, onOpen, onDelete }) {
  const t = useText("agents"), c = t.cols ?? {};
  return (
    <div className="scroll">
      <table className="tbl">
        <thead><tr><th>{c.agent}</th><th>{c.health}</th><th>{c.runs}</th><th>{c.flagged}</th><th>{c.blocked}</th><th>{c.risk}</th><th>{c.env}</th><th>{c.seen}</th>{onDelete && <th />}</tr></thead>
        <tbody>
          {agents.map((a) => { const [v, col] = agentHealth(a, t); return (
            <tr key={a.id} className="clickable" onClick={() => onOpen(a)}>
              <td><button className="linkbtn" onClick={(e) => { e.stopPropagation(); onOpen(a); }}>{a.name}</button></td>
              <td><span className="badge sev" style={{ "--c": col }}>{v}</span></td><td>{a.runs}</td><td>{a.flagged_runs}</td><td>{a.blocked_actions}</td><td>{a.avg_risk ?? "–"}</td><td>{a.environment}</td><td>{a.last_seen_at ? timeAgo(a.last_seen_at) : t.never}</td>{onDelete && <td><AgentDelete agent={a} onDelete={onDelete} /></td>}
            </tr>); })}
        </tbody>
      </table>
    </div>
  );
}
