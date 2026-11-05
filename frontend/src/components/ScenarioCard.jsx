import { catLabel, useMeta } from "../hooks/context";
import { MiniStrip } from "../ui";

const human = (s) => s.replace(/_/g, " ");
const clean = (d) => d.replace(/^\[SYNTHETIC[^\]]*\]\s*/, "");

/** One test case: what is scripted, what AgentGuard should do about it. */
export default function ScenarioCard({ scenario: s, selected, onOpen }) {
  const meta = useMeta(), quiet = s.labels.failure_categories.length === 0, act = meta.actions?.[s.labels.expected_action];
  return (
    <button className={"scn " + (quiet ? "q" : "f") + (selected ? " on" : "")} onClick={() => onOpen(s)} aria-label={`Open ${s.id}`}>
      <span className="scn-top"><span className="tag">{human(s.category)}</span><b className="mono">{s.id}</b></span>
      <span className="scn-d">{clean(s.description)}</span>
      <MiniStrip steps={s.preview} mark={s.labels.earliest_detectable_step} />
      <span className="scn-f">{quiet ? <span className="tag ok">✓ should stay quiet</span> : <span className="tag miss">{s.labels.failure_categories.map((c) => catLabel(meta, c)).slice(0, 2).join(", ")}{s.labels.failure_categories.length > 2 ? ` +${s.labels.failure_categories.length - 2}` : ""}</span>}</span>
      <span className="scn-r muted small">{act?.icon} {act?.label ?? "—"} · {s.n_events} steps{s.split ? ` · ${s.split} set` : ""}</span>
    </button>
  );
}
