const ICON = { run_start: "▶", run_end: "■", tool_call: "→", tool_result: "←", human_approval: "✔", recovery_attempt: "↻", model_request: "…", validation_failure: "!" };
const NAME = { run_start: "Start", run_end: "End", human_approval: "Approval", recovery_attempt: "Recovery" };
export const eventName = (e) => e.tool_name ? `${e.event_type === "tool_call" ? "Call" : "Result"}: ${e.tool_name}` : NAME[e.event_type] ?? e.event_type.replace(/_/g, " ");
/** Horizontal story of a run. markers: {eventId: ["Origin", ...]}, evidence: Set of event ids. */
export default function Flow({ events, markers = {}, evidence = new Set(), selected, onSelect }) {
  return (
    <div className="flow" role="list" aria-label="Run timeline">
      {events.map((e, i) => {
        const bad = e.status === "error", ev = evidence.has(e.event_id), denied = e.event_type === "human_approval" && e.metadata?.approved === false;
        return (
          <div className="flow-step" role="listitem" key={e.event_id}>
            <div className="flow-marks">{(markers[e.event_id] ?? []).map((m) => <span key={m} className={"mark m-" + m.split(" ")[0].toLowerCase()}>{m}</span>)}</div>
            <button type="button" aria-label={`Step ${e.step_index}: ${eventName(e)}${bad ? ", error" : ""}`} aria-pressed={selected === e.event_id}
              className={"node" + (bad || denied ? " bad" : "") + (ev ? " ev" : "") + (selected === e.event_id ? " sel" : "")} onClick={() => onSelect?.(e.event_id)}>
              <span className="node-i">{denied ? "✖" : ICON[e.event_type] ?? "•"}</span>
              <span className="node-n">{eventName(e)}</span>
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
  if (!event) return <p className="muted">Click any step above to inspect its (redacted) inputs and outputs.</p>;
  const hit = findings.filter((f) => f.evidence_event_ids.includes(event.event_id));
  return (
    <div className="inspector">
      <div className="row"><b>{eventName(event)}</b><span className="badge">step {event.step_index}</span><span className="badge">{event.event_type}</span>
        <span className="badge sev" style={{ "--c": event.status === "error" ? "var(--bad)" : "var(--good)" }}>{event.status}{event.error_type ? ` · ${event.error_type}` : ""}</span></div>
      {hit.map((f, i) => <p key={i} className="callout">⚠ Evidence for “{f.label}”: {f.explanation}</p>)}
      <div className="cols">
        {event.tool_input && <div><h4>Input</h4><pre>{JSON.stringify(event.tool_input, null, 1)}</pre></div>}
        {event.tool_output != null && <div><h4>Output</h4><pre>{JSON.stringify(event.tool_output, null, 1)}</pre></div>}
        {Object.keys(event.metadata ?? {}).length > 0 && <div><h4>Details</h4><pre>{JSON.stringify(event.metadata, null, 1)}</pre></div>}
      </div>
    </div>
  );
}
