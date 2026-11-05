import { Toggle, sevColor } from "../ui";

/** One safety rule (policy). The wording of the condition comes from the server's spec, passed in as `conditionText`. */
export default function SafetyRuleCard({ rule, conditionText, canEdit, onToggle, onEdit, onHistory }) {
  const a = rule.definition.action;
  return (
    <article className={"policy" + (rule.enabled ? "" : " off")} style={{ "--c": a === "BLOCK" ? "var(--bad)" : a === "REQUIRE_APPROVAL" ? "var(--warn)" : "var(--acc)" }}>
      <div className="row">
        <Toggle checked={rule.enabled} disabled={!canEdit} label={`Enable ${rule.name}`} onChange={(v) => onToggle(rule, v)} />
        <b className="mono">{rule.name}</b>
        <span className="badge sev" style={{ "--c": "var(--c)" }}>{a.replace(/_/g, " ")}</span>
        <span className="badge" style={{ color: sevColor(rule.definition.severity) }}>{rule.definition.severity}</span>
        <span className="badge">v{rule.version}</span><span className="muted small">{rule.category.replace(/_/g, " ")}</span>
      </div>
      <p>{rule.description}</p>
      <p className="small"><b>Applies to:</b> {rule.definition.scope.agents.join(", ")} agent(s), {rule.definition.scope.tools.join(", ")} tool(s) · <b>When:</b> {conditionText}</p>
      <div className="row">
        <span className="muted small">{rule.evaluations} checks · {rule.matches} triggered</span>
        <button className="linkbtn" onClick={() => onEdit(rule)}>{canEdit ? "Edit / test" : "View / test"}</button>
        <button className="linkbtn" onClick={() => onHistory(rule)}>Version history ({rule.n_versions})</button>
      </div>
    </article>
  );
}
