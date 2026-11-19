import { useEffect, useState } from "react";
import { agentApi, download, fill, paths, teamApi, useApi, useAuth, useMeta, usePolling, useText } from "../api";
import DeveloperHandoff from "../components/DeveloperHandoff";
import IntegrationWizard from "../components/IntegrationWizard";
import TrySample from "../components/TrySample";
import { State, useToast } from "../ui";
import { go } from "../router";
import { useT } from "../hooks/context";

/** Connect an agent: three ways in (try a sample, guided connect, hand to a developer). All wording comes from the server. */
export default function Integrations({ params }) {
  const txt = useT("integrations"), t = useText("connect"), cm = useText("common"), meta = useMeta(), { allowed } = useAuth(), toast = useToast(), way = params?.way ?? "";
  const settings = useApi(paths.settings), agents = useApi(paths.agents);
  const [name, setName] = useState(t.agent_default ?? ""), [registered, setRegistered] = useState(false), [key, setKey] = useState(null), [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [watch, setWatch] = useState(false), [result, setResult] = useState(null);
  const trimmed = name.trim(), starter = useApi(way === "mine" && registered && trimmed ? paths.agentStarter(trimmed) : null);
  usePolling(() => { if (watch) agents.reload(); }, 4000);
  useEffect(() => { setRegistered(false); setKey(null); }, [trimmed]);
  useEffect(() => { if (!t.agent_default) return; setName((n) => n || t.agent_default); }, [t.agent_default]);

  const mine = (agents.data?.items ?? []).find((a) => a.name === trimmed), connected = Boolean(mine && (mine.runs > 0 || mine.test_runs > 0)), theKey = key?.key ?? (pasted.trim() || null);
  async function register() {
    setBusy(true); setError(null);
    try { if (!(agents.data?.items ?? []).some((a) => a.name === trimmed)) await agentApi.register(trimmed); setRegistered(true); agents.reload(); return true; }
    catch (e) { if (/already registered/.test(e.message)) { setRegistered(true); return true; } setError(e.message); return false; }
    finally { setBusy(false); }
  }
  async function createKey() { setBusy(true); try { setKey(await teamApi.createKey(txt("guided_key_name", { name: trimmed || txt("agent_fallback") }))); } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); } }
  async function runSample(sample) { setBusy(true); setError(null); try { setResult(await agentApi.sampleRun(trimmed, sample)); agents.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const onDownload = () => starter.data && download(starter.data.filename, starter.data.content.replace("PASTE_YOUR_KEY_HERE", theKey ?? ""), "text/x-python");
  if (!settings.data || !t.choices) return <State loading={settings.loading} error={settings.error} h={240} onRetry={settings.reload} />;

  const c = settings.data.system.connect, server = starter.data?.server ?? window.location.origin;
  const message = fill(t.dev?.template, { agent: trimmed || t.agent_default, install: c.install, snippet: c.snippet.replace("YOUR_API_KEY", theKey ?? t.dev?.key_missing).replace("AGENT_NAME", trimmed || t.agent_default), server, key: theKey ?? t.dev?.key_missing });
  const back = <button className="linkbtn" onClick={() => go("/integrations")}>{t.back}</button>;
  return (
    <div className="stack">
      {!way && <>
        <p className="lead">{t.intro}</p>
        <div className="choices-grid">{t.choices.map((x) => (
          <button key={x.key} className="choice-card" onClick={() => go("/integrations", { way: x.key })}>
            <span className="cc-i" aria-hidden="true">{x.icon}</span><b>{x.title}</b><span className="muted">{x.body}</span><span className="cc-go">{x.button} →</span>
          </button>))}</div>
      </>}
      {way && back}
      {way === "try" && <TrySample text={t.try} samples={meta.sample_runs ?? []} agentName={name} onAgentNameChange={setName} onRun={runSample} canRun={allowed("run_sample_agent")} busy={busy} result={result} error={error}
        onSeeRun={null} onReset={() => setResult(null)} />}
      {way === "mine" && <IntegrationWizard text={t.mine} labels={{ back: t.back_step ?? "←", next: t.next ?? "→", agent_label: t.agent_label, agent_hint: t.agent_hint, agent_placeholder: t.agent_placeholder }} agentName={name} onAgentNameChange={setName} onRegister={register} registered={registered}
        apiKey={key?.key ?? null} onCreateKey={createKey} canCreateKey={allowed("manage_keys")} pastedKey={pasted} onPasteKey={setPasted} starter={starter.data} onDownload={onDownload}
        connection={{ state: connected ? "connected" : "waiting", runs: (mine?.runs ?? 0) + (mine?.test_runs ?? 0) }} onCheck={() => { setWatch(true); agents.reload(); }} busy={busy} error={error} onSeeRuns={() => go("/traces", { agent: trimmed })} onDeveloper={() => go("/integrations", { way: "dev" })} />}
      {way === "dev" && <DeveloperHandoff text={t.dev} message={message} />}
      <div className="row"><button className="linkbtn" onClick={() => go("/agents")}>{cm.see_all_agents}</button>{allowed("manage_keys") && <button className="linkbtn" onClick={() => go("/settings", { tab: "keys" })}>{t.keys_link}</button>}</div>
    </div>
  );
}
