import { useState } from "react";
import { fill } from "../hooks/context";
import { CopyButton } from "../ui";
import { useT } from "../hooks/context";

/**
 * Guided path for connecting your own agent, for someone who does not write code.
 * Everything it says comes from `text` (the server's connect.mine text); the page does the API work.
 */
export default function IntegrationWizard({ text: t, labels, agentName, onAgentNameChange, onRegister, registered, apiKey, onCreateKey, canCreateKey, pastedKey, onPasteKey, starter, onDownload, connection, onCheck, busy, error, onSeeRuns, onDeveloper }) {
  const txt = useT("integration_wizard");
  const [step, setStep] = useState(0), steps = t.steps, cur = steps[step], hasKey = Boolean(apiKey || pastedKey?.trim());
  const go = (n) => setStep(Math.max(0, Math.min(steps.length - 1, n)));
  const nav = (back, next) => <div className="row">{back != null && <button className="btn" onClick={() => go(back)}>{labels.back}</button>}{next}</div>;
  return (
    <section className="card wizard">
      <h2 className="card-t">{t.title}</h2>
      <ol className="wiz-steps" aria-label={t.title}>
        {steps.map((s, i) => <li key={s.key} className={i === step ? "on" : i < step ? "done" : ""}><button onClick={() => go(i)} aria-current={i === step ? "step" : undefined}><span className="num">{i < step ? "✓" : i + 1}</span>{s.title}</button></li>)}
      </ol>
      {error && <div role="alert" className="alert">{error}</div>}

      {cur.key === "name" && <div className="stack">
        <p>{cur.body}</p>
        <label className="field">{labels.agent_label}<input value={agentName} onChange={(e) => onAgentNameChange(e.target.value)} placeholder={labels.agent_placeholder} /><span className="muted small">{labels.agent_hint}</span></label>
        <div className="row"><button className="btn primary" disabled={busy || !agentName.trim()} onClick={async () => { if (await onRegister()) go(1); }}>{registered ? labels.next : cur.button}</button>{registered && <span className="okt">✓ {fill(cur.done, { name: agentName })}</span>}</div>
      </div>}

      {cur.key === "key" && <div className="stack">
        <p>{cur.body}</p>
        {apiKey ? <div className="keybox" role="status"><b>{cur.once}</b><code>{apiKey}</code><CopyButton text={apiKey} /></div>
          : canCreateKey ? <button className="btn primary" disabled={busy} onClick={onCreateKey}>{cur.button}</button>
          : <p className="muted">{cur.locked}</p>}
        {!apiKey && <label className="field">{cur.paste_label}<input value={pastedKey} onChange={(e) => onPasteKey(e.target.value)} placeholder={cur.paste_placeholder} autoComplete="off" spellCheck={false} /></label>}
        {nav(0, <button className="btn primary" disabled={!hasKey} onClick={() => go(2)}>{labels.next}</button>)}
      </div>}

      {cur.key === "file" && <div className="stack">
        <p>{cur.body}</p>
        {!hasKey && <p className="muted">{cur.need_key}</p>}
        <div className="row"><button className="btn primary" disabled={!hasKey || !starter} onClick={onDownload}>{cur.button}{starter ? ` (${starter.filename})` : ""}</button></div>
        {nav(1, <button className="btn" disabled={!hasKey} onClick={() => go(3)}>{labels.next}</button>)}
      </div>}

      {cur.key === "run" && <div className="stack">
        <p>{cur.body}</p>
        <div className="how"><h3>{cur.python_title}</h3><p>{cur.python_body}</p></div>
        <div className="how"><h3>{cur.open_title}</h3><p>{cur.open_windows}</p><p>{cur.open_mac}</p></div>
        <div className="how"><h3>{cur.run_title}</h3><p>{cur.run_body}</p><div className="row"><pre className="grow">{txt("python_filename", { filename: starter?.filename })}</pre><CopyButton text={txt("python_v1", { v1: starter?.filename ?? "" })} /></div><p className="muted">{cur.expect}</p></div>
        <details className="how"><summary>{cur.trouble_title}</summary><ul className="plain">{cur.trouble.map((x) => <li key={x.q}><b>{x.q}</b><div className="muted">{x.a}</div></li>)}</ul></details>
        {nav(2, <button className="btn primary" onClick={() => { go(4); onCheck(); }}>{cur.next}</button>)}
      </div>}

      {cur.key === "check" && <div className="stack">
        {connection.state === "connected"
          ? <div className="callout good" role="status"><b>✓ {fill(cur.ok, { name: agentName, n: connection.runs })}</b> <button className="linkbtn" onClick={onSeeRuns}>{cur.see} →</button></div>
          : <div className="callout warn" role="status"><b>{fill(cur.waiting, { name: agentName })}</b><div className="muted small">{cur.waiting_hint}</div></div>}
        <div className="how"><h3>{cur.next_title}</h3><p>{cur.next_body}</p><button className="btn" onClick={onDeveloper}>{cur.dev}</button></div>
        {nav(3, <button className="btn" onClick={onCheck}>{cur.again}</button>)}
      </div>}
    </section>
  );
}
