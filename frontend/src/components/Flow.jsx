
import { useT } from "../hooks/context";const ICON = { policy_check: "🛡", risk_detected: "⚠", llm_response: "…", recovery_completed: "↻", agent_error: "!", run_start: "▶", run_end: "■", tool_call: "→", tool_result: "←", human_approval: "✔", recovery_attempt: "↻", model_request: "…", validation_failure: "!" };
const NAME = { run_start: "ev_start", run_end: "ev_end", human_approval: "ev_approval", recovery_attempt: "ev_recovery" };
export const eventName = (e, txt) => e.event_type === "policy_check" ? txt("ev_policy", { what: e.metadata?.effective?.replace(/_/g, " ").toLowerCase() ?? txt("ev_policy_check") }) : e.event_type === "risk_detected" ? txt("ev_risk") : e.tool_name ? txt(e.event_type === "tool_call" ? "ev_call" : "ev_result", { tool: e.tool_name }) : NAME[e.event_type] ? txt(NAME[e.event_type]) : e.event_type.replace(/_/g, " ");
/** Horizontal story of a run. markers: {eventId: ["Origin", ...]}, evidence: Set of event ids. */
export default function Flow({ events, markers = {}, evidence = new Set(), selected, onSelect }) {
  const txt = useT("flow");
  return (
    <div className="flow" role="list" aria-label={txt("run_timeline")}>
      {events.map((e, i) => {
        const bad = e.status === "error", ev = evidence.has(e.event_id), denied = e.event_type === "human_approval" && e.metadata?.approved === false;
        return (
          <div className="flow-step" role="listitem" key={e.event_id}>
            <div className="flow-marks">{(markers[e.event_id] ?? []).map((m) => <span key={m} className={"mark m-" + m.split(" ")[0].toLowerCase()}>{m}</span>)}</div>
            <button type="button" aria-label={txt("step_step_index_v2v3", { step_index: e.step_index, v2: eventName(e, txt), v3: bad ? txt("with_error") : "" })} aria-pressed={selected === e.event_id}
              className={"node" + (bad || denied ? " bad" : "") + (ev ? " ev" : "") + (selected === e.event_id ? " sel" : "")} onClick={() => onSelect?.(e.event_id)}>
              <span className="node-i">{denied ? "✖" : ICON[e.event_type] ?? "•"}</span>
              <span className="node-n">{eventName(e, txt)}</span>
              <span className="node-s">#{e.step_index}{bad && e.error_type ? ` · ${e.error_type}` : ""}</span>
            </button>
            {i < events.length - 1 && <span className="flow-arrow" aria-hidden="true">›</span>}
          </div>
        );
      })}
    </div>
  );
}
export function Inspector({ event, findings = [] }) {
  const txt = useT("flow");
  if (!event) return <p className="muted">{txt("click_any_step_above_to")}</p>;
  const hit = findings.filter((f) => f.evidence_event_ids.includes(event.event_id));
  return (
    <div className="inspector">
      <div className="row"><b>{eventName(event, txt)}</b><span className="badge">{txt("step_step_index", { step_index: event.step_index })}</span><span className="badge">{event.event_type}</span>
        <span className="badge sev" style={{ "--c": event.status === "error" ? "var(--bad)" : "var(--good)" }}>{event.status}{event.error_type ? ` · ${event.error_type}` : ""}</span></div>
      {hit.map((f, i) => <p key={i} className="callout">{txt("evidence_for_label_explanation", { label: f.label, explanation: f.explanation })}</p>)}
      <div className="cols">
        {event.tool_input && <div><h4>{txt("input")}</h4><pre>{JSON.stringify(event.tool_input, null, 1)}</pre></div>}
        {event.tool_output != null && <div><h4>{txt("output")}</h4><pre>{JSON.stringify(event.tool_output, null, 1)}</pre></div>}
        {Object.keys(event.metadata ?? {}).length > 0 && <div><h4>{txt("details")}</h4><pre>{JSON.stringify(event.metadata, null, 1)}</pre></div>}
      </div>
    </div>
  );
}
