import { State, useApi } from "../api";
export default function Settings() {
  const h = useApi<{ status: string; database: string }>("/health");
  const s = useApi<{ llm_configured: boolean; llm_provider: string | null; ai_diagnosis_enabled: boolean; max_retries: number; retention: string; rules: string[]; redaction: Record<string, unknown> }>("/api/v1/settings");
  return (<><h2>Settings &amp; Integrations</h2><State loading={h.loading || s.loading} error={h.error || s.error} />
    {h.data && <div className="card"><h3>Health</h3>Backend: {h.data.status} · Database: {h.data.database}</div>}
    {s.data && <><div className="card"><h3>LLM provider</h3>{s.data.llm_configured ? `Configured (${s.data.llm_provider ?? "unnamed"}); key not shown` : "Not configured. The deterministic engine works without it."} · AI diagnosis: {s.data.ai_diagnosis_enabled ? "on" : "off"}</div>
      <div className="card"><h3>Limits &amp; retention</h3>Max retries: {s.data.max_retries} · Retention: {s.data.retention}</div>
      <div className="card"><h3>Detection rules (active)</h3>{s.data.rules.join(", ")}</div>
      <div className="card"><h3>Redaction</h3><pre>{JSON.stringify(s.data.redaction)}</pre></div>
      <div className="card"><h3>Integrate your agent</h3><pre>{`from agentguard_sdk import Tracer, http_transport
tracer = Tracer("my-agent", http_transport("http://localhost:8000"))
with tracer.run(required_tools=["lookup"]) as run:
    run.call("lookup", {"order_id": 1}, fn=lookup, read_only=True)
    run.finish(claimed_success=True)`}</pre></div></>}</>);
}
