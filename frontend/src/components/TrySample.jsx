import { useState } from "react";
import { catLabel, fill, useMeta } from "../hooks/context";

/** "Try it now": pick a situation, run it as a sample agent, see what AgentGuard noticed. Presentational: the page does the API call. */
export default function TrySample({ text: t, samples, agentName, onAgentNameChange, onRun, canRun, busy, result, error, onSeeRun, onReset }) {
  const meta = useMeta(), [pick, setPick] = useState(samples[0]?.key ?? "");
  return (
    <section className="card stack">
      <h2 className="card-t">{t.title}</h2>
      <p>{t.intro}</p>
      {error && <div role="alert" className="alert">{error}</div>}
      {result ? (
        <div className={"callout " + (result.findings ? "warn" : "good")} role="status">
          <b>{result.findings ? fill(t.found, { n: result.findings, headline: result.headline }) : t.clean}</b>
          {result.categories?.length > 0 && <div className="muted small">{result.categories.map((c) => catLabel(meta, c)).join(" · ")}</div>}
          <div className="row">{onSeeRun && <button className="btn primary" onClick={() => onSeeRun(result.trace_id)}>{t.see}</button>}<button className="btn" onClick={onReset}>{t.again}</button></div>
        </div>
      ) : (
        <>
          <fieldset className="choices"><legend className="sr-only">{t.title}</legend>
            {samples.map((s) => (
              <label key={s.key} className={"choice" + (pick === s.key ? " on" : "")}>
                <input type="radio" name="sample" value={s.key} checked={pick === s.key} onChange={() => setPick(s.key)} />
                <span><b>{s.label}</b><span className="muted small">{s.plain}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="field">{t.agent_label}<input value={agentName} onChange={(e) => onAgentNameChange(e.target.value)} /></label>
          <div className="row"><button className="btn primary" disabled={busy || !canRun || !agentName.trim() || !pick} onClick={() => onRun(pick)}>{busy ? t.running : t.run}</button>{!canRun && <span className="muted small">{t.locked}</span>}</div>
        </>
      )}
      <p className="muted small">{t.note}</p>
    </section>
  );
}
