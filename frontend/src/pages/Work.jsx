import { useState } from "react";
import { demoApi, paths, setDataScope, useApi, useAuth, useMeta, usePolling, useText } from "../api";
import { go } from "../router";
import EmptyState from "../components/EmptyState";
import { Card, State, useToast } from "../ui";

/** Member home: what needs a person right now. Every sentence comes from the server (ui.work). */
export default function Work() {
  const t = useText("work"), { allowed } = useAuth(), toast = useToast(), meta = useMeta(), [busy, setBusy] = useState(false);
  const appr = useApi(paths.approvals({ status: "pending", limit: 5 })), risk = useApi(paths.riskMonitor({ limit: 5 })), ov = useApi(paths.overview());
  usePolling(appr.reload, 10000);
  const urgent = ov.data?.live?.recent_incidents ?? [];
  async function demo() { setBusy(true); try { await demoApi.seed(); toast(t.demo_done); setDataScope("synthetic"); ov.reload(); risk.reload(); } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); } }
  const actions = [["connect_agents", t.action_connect, () => go("/integrations")], ["run_benchmark", t.action_bench, () => go("/bench")], ["load_demo", t.action_demo, demo]].filter(([cap]) => allowed(cap));
  return (
    <div className="stack">
      <p className="lead">{t.intro}</p>
      <Card title={t.approvals_title} sub={t.approvals_sub} right={<button className="btn" onClick={() => go("/approvals")}>{t.approvals_cta}</button>}>
        <State loading={appr.loading && !appr.data} error={appr.error} h={80} onRetry={appr.reload} />
        {appr.data && (appr.data.items.length === 0 ? <EmptyState title={t.approvals_empty} icon="✅" /> : <ul className="plain">{appr.data.items.map((a) => <li key={a.id}><b>{a.tool ?? a.action ?? "#" + a.id}</b> <span className="muted small">{a.agent_name ?? a.trace_id}</span></li>)}</ul>)}
      </Card>
      <Card title={t.risk_title} sub={t.risk_sub} right={<button className="btn" onClick={() => go("/risk")}>{t.risk_cta}</button>}>
        <State loading={risk.loading && !risk.data} error={risk.error} h={80} onRetry={risk.reload} />
        {risk.data && (risk.data.items.length === 0 ? <EmptyState title={t.risk_empty} icon="✅" /> : <ul className="plain">{risk.data.items.map((r) => <li key={r.trace_id}><a href={"#/traces/" + encodeURIComponent(r.trace_id)}>{r.task || r.trace_id}</a> <span className="muted small">{r.agent_name} · {t.risk_label} {Math.round(r.risk_score)}</span></li>)}</ul>)}
      </Card>
      <Card title={t.problems_title} sub={t.problems_sub} right={<button className="btn" onClick={() => go("/problems")}>{t.problems_cta}</button>}>
        <State loading={ov.loading && !ov.data} error={ov.error} h={80} onRetry={ov.reload} />
        {ov.data && (urgent.length === 0 ? <EmptyState title={t.problems_empty} icon="✅" /> : <ul className="plain">{urgent.map((r) => <li key={r.trace_id}><a href={"#/traces/" + encodeURIComponent(r.trace_id)}>{r.headline || r.task || r.trace_id}</a> <span className="muted small">{(r.categories ?? []).map((c) => meta.categories?.[c]?.label ?? c).join(", ")}</span></li>)}</ul>)}
      </Card>
      {actions.length > 0 && <Card title={t.actions_title}><div className="row">{actions.map(([cap, label, fn]) => <button key={cap} className="btn primary" disabled={busy} onClick={fn}>{label}</button>)}</div></Card>}
    </div>
  );
}
