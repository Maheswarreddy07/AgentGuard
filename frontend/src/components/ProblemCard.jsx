import { SevBadge, sevColor, timeAgo } from "../ui";

/** One detected problem, summarised. `problem` is a finding from the API. */
export default function ProblemCard({ problem, onOpen }) {
  return (
    <article className="problem-card" style={{ "--c": sevColor(problem.severity) }}>
      <div className="row"><b>{problem.label}</b><SevBadge sev={problem.severity} /><span className="badge">{problem.source === "rule" ? "proven by rule" : "heuristic"}</span></div>
      <p>{problem.description}</p>
      <div className="row">
        <a className="mono small" href={"#/traces/" + problem.trace_id}>{problem.trace_id}</a>
        <span className="muted small">{timeAgo(problem.detected_at)}</span>
        <button className="btn" onClick={() => onOpen(problem)}>See details</button>
      </div>
    </article>
  );
}
