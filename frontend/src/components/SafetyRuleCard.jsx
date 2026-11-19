import { Toggle, sevColor, timeAgo } from "../ui";
import ConfirmDelete from "./ConfirmDelete";
import { useT } from "../hooks/context";

/** One safety rule (policy). The wording of the condition comes from the server's spec, passed in as `conditionText`. */
export default function SafetyRuleCard({ rule, conditionText, canEdit, onToggle, onEdit, onHistory, onDelete }) {
  const txt = useT("safety_rule_card");
  const a = rule.definition.action;
  return (
    <article className={"policy" + (rule.enabled ? "" : " off")} style={{ "--c": a === "BLOCK" ? "var(--bad)" : a === "REQUIRE_APPROVAL" ? "var(--warn)" : "var(--acc)" }}>
      <div className="row">
        <Toggle checked={rule.enabled} disabled={!canEdit} label={txt("enable_name", { name: rule.name })} onChange={(v) => onToggle(rule, v)} />
        <b className="mono">{rule.name}</b>
        <span className="badge sev" style={{ "--c": "var(--c)" }}>{a.replace(/_/g, " ")}</span>
        <span className="badge" style={{ color: sevColor(rule.definition.severity) }}>{rule.definition.severity}</span>
        <span className="badge">{txt("vversion", { version: rule.version })}</span><span className="muted small">{rule.category.replace(/_/g, " ")}</span>
      </div>
      <p>{rule.description}</p>
      <p className="small"><b>{txt("applies_to")}</b> {rule.definition.scope.agents.join(", ")} {txt("agent_s")} {rule.definition.scope.tools.join(", ")} {txt("tool_s")} <b>{txt("when")}</b> {conditionText}</p>
      <div className="row">
        <span className="muted small">{txt("evaluations_checks_matches_triggered", { evaluations: rule.evaluations, matches: rule.matches })}</span>
        <span className="muted small rule-effects">{rule.matches === 0 || !rule.effects ? txt("effects_none") : txt("effects_line", { blocked: rule.effects.blocked, approval: rule.effects.approval_requested, warned: rule.effects.warned, watched: rule.effects.only_watched ? txt("effects_watched", { n: rule.effects.only_watched }) : "" }) + (rule.effects.last_matched_at ? txt("effects_last", { when: timeAgo(rule.effects.last_matched_at) }) : "")}</span>
        <button className="linkbtn" onClick={() => onEdit(rule)}>{canEdit ? txt("edit_test") : txt("view_test")}</button>
        <button className="linkbtn" onClick={() => onHistory(rule)}>{txt("version_history_n_versions", { n_versions: rule.n_versions })}</button>
        {canEdit && onDelete && <span className="push"><ConfirmDelete kind="rule" vars={{ name: rule.name }} onConfirm={() => onDelete(rule)} /></span>}
      </div>
    </article>
  );
}
