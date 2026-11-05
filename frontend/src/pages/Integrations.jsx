import { useEffect, useRef, useState } from "react";
import { agentApi, paths, teamApi, useApi, useAuth, usePolling } from "../api";
import AgentTable from "../components/AgentTable";
import IntegrationWizard from "../components/IntegrationWizard";
import { Card, State, useToast } from "../ui";
import { go } from "../router";

export default function Integrations() {
  const { can } = useAuth(), toast = useToast();
  const settings = useApi(paths.settings), agents = useApi(paths.agents);
  const [name, setName] = useState(""), [registered, setRegistered] = useState(false), [key, setKey] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null), [watch, setWatch] = useState(false);
  const startedAt = useRef(Date.now());
  usePolling(() => { if (watch) agents.reload(); }, 4000);

  async function register() {
    setBusy(true); setError(null);
    try { if (!(agents.data?.items ?? []).some((a) => a.name === name.trim())) await agentApi.register(name.trim()); setRegistered(true); agents.reload(); return true; }
    catch (e) { if (/already registered/.test(e.message)) { setRegistered(true); return true; } setError(e.message); return false; }
    finally { setBusy(false); }
  }
  async function createKey() { setBusy(true); try { setKey(await teamApi.createKey(`${name.trim() || "agent"} (wizard)`)); } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); } }
  useEffect(() => { setRegistered(false); }, [name]);
  if (!settings.data) return <State loading={settings.loading} error={settings.error} h={240} onRetry={settings.reload} />;

  const mine = (agents.data?.items ?? []).find((a) => a.name === name.trim());
  const connected = Boolean(mine && mine.runs > 0);
  const c = settings.data.system.connect;
  return (
    <div className="stack">
      <IntegrationWizard agentName={name} onAgentNameChange={setName} onRegister={register} registered={registered} apiKey={key} onCreateKey={createKey} canCreateKey={can("admin")} install={c.install} snippet={c.snippet}
        connection={{ state: connected ? "connected" : "waiting", runs: mine?.runs ?? 0 }} onCheck={() => { setWatch(true); agents.reload(); }} busy={busy} error={error} />
      <Card title="Your agents" sub="Everything already connected" right={<button className="linkbtn" onClick={() => go("/settings", { tab: "keys" })}>Manage API keys →</button>}>
        {agents.data?.items?.length ? <AgentTable agents={agents.data.items} onOpen={(a) => go("/traces", { agent: a.name })} /> : <p className="muted">No agents yet.</p>}
      </Card>
    </div>
  );
}
