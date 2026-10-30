import { useState } from "react";
import { useApi, useMeta } from "../api";
import { Card, State } from "../ui";
const SNIPPET = `from agentguard_sdk import Tracer, http_transport

tracer = Tracer("my-agent", http_transport("http://localhost:8000"))
with tracer.run(required_tools=["lookup_order"]) as run:
    run.call("lookup_order", {"order_id": 1}, fn=lookup_order, read_only=True,
             arg_schema={"required": ["order_id"], "types": {"order_id": "integer"}})
    run.approval("issue_refund", approved=True)
    run.call("issue_refund", {"amount": 20}, fn=issue_refund, consequential=True)
    run.finish(claimed_success=True)`;
const Status = ({ ok, children }) => <div className="status"><span className={"dot " + (ok ? "up" : "warn")} />{children}</div>;
export default function Settings() {
  const meta = useMeta(), h = useApi("/health"), s = useApi("/api/v1/settings"), [copied, setCopied] = useState(false);
  if (!s.data) return <State loading={s.loading} error={s.error} h={200} />;
  const d = s.data;
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="System status">
          <Status ok={h.data?.status === "ok"}>Backend {h.data?.status === "ok" ? "running" : "unreachable"} {h.data?.version && <span className="muted">v{h.data.version}</span>}</Status>
          <Status ok={h.data?.database === "ok"}>Database {h.data?.database === "ok" ? "connected" : "unreachable"}</Status>
          <Status ok={d.ai_diagnosis_enabled}>AI diagnosis {d.ai_diagnosis_enabled ? `on (${d.llm_provider})` : "off — optional, everything else works without it"}</Status>
        </Card>
        <Card title="Safety limits">
          <ul className="plain"><li>Max automatic retries: <b>{d.max_retries}</b></li><li>Rate limit: <b>{d.rate_limit_per_min || "off"}</b> requests/min per client</li><li>Max events per request: <b>{d.max_events_per_request}</b></li><li>Data retention: <b>{d.retention}</b></li>
            <li>Redaction: passwords, tokens, API keys, emails and SSNs are masked before storage; long text is truncated.</li></ul>
        </Card>
      </div>
      <Card title="Connect your agent" right={<button className="btn" onClick={() => { navigator.clipboard?.writeText(SNIPPET); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy"}</button>}>
        <pre>{SNIPPET}</pre><p className="muted">AgentGuard can only detect problems you describe: declare an argument schema, required tools, and which actions are consequential.</p>
      </Card>
      <Card title="Detection rules in use"><div className="chips">{d.rules.map((r) => <span key={r} className="tag">{r.replace(/_/g, " ")}</span>)}</div></Card>
      <Card title="Glossary — what the metrics mean">
        <dl className="gloss">{Object.entries(meta.metrics).map(([k, v]) => <div key={k}><dt>{v.label}</dt><dd>{v.plain}</dd></div>)}</dl>
      </Card>
    </div>
  );
}
