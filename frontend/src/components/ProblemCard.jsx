import { SevBadge, sevColor, timeAgo } from "../ui";
import { useT } from "../hooks/context";

/** One detected problem, summarised. `problem` is a finding from the API. */
export default function ProblemCard({ problem, onOpen }) {
  const txt = useT("problem_card");
  return (
    <article className="problem-card" style={{ "--c": sevColor(problem.severity) }}>
      <div className="row"><b>{problem.label}</b><SevBadge sev={problem.severity} /><span className="badge">{problem.source === "rule" ? txt("proven_by_rule") : txt("heuristic")}</span></div>
      <p>{problem.description}</p>
      <div className="row">
        <a className="mono small" href={"#/traces/" + problem.trace_id}>{problem.trace_id}</a>
        <span className="muted small">{timeAgo(problem.detected_at)}</span>
        <button className="btn" onClick={() => onOpen(problem)}>{txt("see_details")}</button>
      </div>
    </article>
  );
}
