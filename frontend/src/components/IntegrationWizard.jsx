import { useState } from "react";
import { CopyButton } from "../ui";

const STEPS = ["Name your agent", "Get a key", "Add the code", "Check the connection"];

/** Four-step guide to connect an agent. Everything it needs arrives as props; the page does the API work. */
export default function IntegrationWizard({ agentName, onAgentNameChange, onRegister, registered, apiKey, onCreateKey, canCreateKey, install, snippet, connection, onCheck, busy, error }) {
  const [step, setStep] = useState(0);
  const filled = snippet.replace("YOUR_API_KEY", apiKey?.key ?? "YOUR_API_KEY").replace("AGENT_NAME", agentName || "my-agent");
  const go = (n) => setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  return (
    <section className="card wizard">
      <ol className="wiz-steps" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "done" : ""}><button onClick={() => go(i)} aria-current={i === step ? "step" : undefined}><span className="num">{i < step ? "✓" : i + 1}</span>{s}</button></li>)}
      </ol>
      {error && <div role="alert" className="alert">{error}</div>}

      {step === 0 && <div className="stack">
        <p>Give the agent a short name. It shows up in every run, problem and report.</p>
        <label className="field">Agent name<input value={agentName} onChange={(e) => onAgentNameChange(e.target.value)} placeholder="support-agent" /></label>
        <div className="row"><button className="btn primary" disabled={busy || !agentName.trim()} onClick={async () => { if (await onRegister()) go(1); }}>{registered ? "Continue" : "Register this agent"}</button>{registered && <span className="okt">✓ “{agentName}” is registered</span>}</div>
      </div>}

      {step === 1 && <div className="stack">
        <p>The agent uses a key to prove who it is. A key can only send runs and ask for decisions — it cannot read your data.</p>
        {apiKey ? <div className="keybox" role="status"><b>Copy this key now — it will not be shown again:</b><code>{apiKey.key}</code><CopyButton text={apiKey.key} /></div>
          : <button className="btn primary" disabled={busy || !canCreateKey} onClick={onCreateKey}>Create a key for “{agentName || "this agent"}”</button>}
        {!canCreateKey && !apiKey && <p className="muted small">Only admins can create keys. Ask an admin for one, then continue.</p>}
        <div className="row"><button className="btn" onClick={() => go(0)}>Back</button><button className="btn primary" onClick={() => go(2)}>Continue</button></div>
      </div>}

      {step === 2 && <div className="stack">
        <p><b>1.</b> Install the SDK in your agent’s environment:</p>
        <div className="row"><pre className="grow">{install}</pre><CopyButton text={install} /></div>
        <p><b>2.</b> Wrap your agent’s tools and runs like this:</p>
        <div className="row"><pre className="grow">{filled}</pre><CopyButton text={filled} /></div>
        <p className="muted small">Tell AgentGuard which tools are <code>consequential</code> (money, deletion, messages) and which send data outside, so it can protect them.</p>
        <div className="row"><button className="btn" onClick={() => go(1)}>Back</button><button className="btn primary" onClick={() => { go(3); onCheck(); }}>I’ve added it — check</button></div>
      </div>}

      {step === 3 && <div className="stack">
        {connection.state === "connected"
          ? <div className="callout" role="status"><b>✓ Connected.</b> “{agentName}” has sent {connection.runs} run{connection.runs === 1 ? "" : "s"}. <a href={"#/traces?agent=" + encodeURIComponent(agentName)}>See its runs →</a></div>
          : <div className="callout" role="status"><b>Waiting for the first run from “{agentName}”…</b><div className="muted small">Run your agent once. This page checks automatically every few seconds.</div></div>}
        <div className="row"><button className="btn" onClick={() => go(2)}>Back</button><button className="btn" onClick={onCheck}>Check again</button></div>
      </div>}
    </section>
  );
}
