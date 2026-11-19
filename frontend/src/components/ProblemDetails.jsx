import { SevBadge, sevColor } from "../ui";
import TechnicalDetails from "./TechnicalDetails";
import { useT } from "../hooks/context";

/** The full story of one problem. Works for a finding from /findings/{id} or one from a run's analysis. */
export default function ProblemDetails({ problem, evidenceEvents = [], selectedEventId, onSelectEvent, stepOf }) {
  const txt = useT("problem_details");
  const text = problem.description ?? problem.explanation;
  const ids = problem.evidence_event_ids ?? [];
  const proven = (problem.source ?? problem.proof) === "rule";
  return (
    <article className="finding" style={{ "--c": sevColor(problem.severity) }}>
      <div className="row"><b>{problem.label}</b><SevBadge sev={problem.severity} /><span className="badge">{proven ? txt("proven_by_rule") : txt("heuristic")}</span>{problem.confidence != null && <span className="muted small">{txt("confidence_confidence", { confidence: problem.confidence })}</span>}</div>
      <p>{text}</p>
      {problem.why && <p className="muted"><b>{txt("why_it_matters")}</b> {problem.why}</p>}
      {problem.fix && <p className="muted"><b>{txt("suggested_fix")}</b> {problem.fix}</p>}
      {ids.length > 0 && onSelectEvent && (
        <div className="chips"><span className="muted">{txt("evidence")}</span>
          {ids.map((eid) => <button key={eid} className={"tag btnlike" + (selectedEventId === eid ? " on" : "")} onClick={() => onSelectEvent(eid)}>{txt("step")} {stepOf?.(eid) ?? "?"}</button>)}
        </div>
      )}
      {evidenceEvents.length > 0 && <TechnicalDetails title={txt("technical_details_the_exact_events")} data={evidenceEvents} />}
    </article>
  );
}
