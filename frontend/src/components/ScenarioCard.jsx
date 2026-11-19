import { catLabel, fill, useMeta, useText } from "../hooks/context";
import { MiniStrip } from "../ui";
import { useT } from "../hooks/context";

const human = (s) => s.replace(/_/g, " ");
export const cleanDescription = (d) => d.replace(/^\[SYNTHETIC[^\]]*\]\s*/, "");

/** Plain-language headline: the problem(s) the run contains, or the server's "nothing wrong" sentence. */
export function scenarioHeadline(s, meta, t) {
  const cats = s.labels.failure_categories;
  if (!cats.length) return t.no_problem_headline ?? "";
  return cats.slice(0, 2).map((c) => catLabel(meta, c)).join(" + ") + (cats.length > 2 ? " " + fill(t.more_problems, { n: cats.length - 2 }) : "");
}

/** One practice situation. `technical` adds id, kind, split, step count and the step strip. All sentences come from the server. */
export default function ScenarioCard({ scenario: s, selected, onOpen, technical = false }) {
  const txt = useT("scenario_card");
  const meta = useMeta(), t = useText("scenarios"), quiet = s.labels.failure_categories.length === 0, act = meta.actions?.[s.labels.expected_action];
  return (
    <button className={"scn " + (quiet ? "q" : "f") + (selected ? " on" : "")} onClick={() => onOpen(s)} aria-label={txt("open_id", { id: s.id })}>
      <span className="scn-top"><span className={"scn-h " + (quiet ? "ok" : "miss")}><span aria-hidden="true">{quiet ? "✓" : "⚠"}</span> {scenarioHeadline(s, meta, t)}</span>{technical && <b className="mono small">{s.id}</b>}</span>
      {technical && <span className="scn-d">{cleanDescription(s.description)}</span>}
      {technical && <MiniStrip steps={s.preview} mark={s.labels.earliest_detectable_step} />}
      <span className="scn-r">{quiet ? t.should_quiet : <>{t.should_do} <b>{act?.icon} {act?.label ?? s.labels.expected_action}</b></>}</span>
      {technical && <span className="muted small">{human(s.category)} · {s.n_events} · {s.split}</span>}
    </button>
  );
}
