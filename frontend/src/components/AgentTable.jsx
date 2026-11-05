import { agentHealth } from "./AgentCard";
import { timeAgo } from "../ui";

export default function AgentTable({ agents, onOpen }) {
  return (
    <div className="scroll">
      <table className="tbl">
        <thead><tr><th>Agent</th><th>Health</th><th>Runs</th><th>Flagged</th><th>Blocked actions</th><th>Average risk</th><th>Environment</th><th>Last seen</th></tr></thead>
        <tbody>
          {agents.map((a) => { const [v, c] = agentHealth(a); return (
            <tr key={a.id} className="clickable" onClick={() => onOpen(a)}>
              <td><button className="linkbtn" onClick={(e) => { e.stopPropagation(); onOpen(a); }}>{a.name}</button></td>
              <td><span className="badge sev" style={{ "--c": c }}>{v}</span></td><td>{a.runs}</td><td>{a.flagged_runs}</td><td>{a.blocked_actions}</td><td>{a.avg_risk ?? "–"}</td><td>{a.environment}</td><td>{a.last_seen_at ? timeAgo(a.last_seen_at) : "never"}</td>
            </tr>); })}
        </tbody>
      </table>
    </div>
  );
}
