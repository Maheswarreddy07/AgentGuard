import { catLabel, fill, paths, useApi, useMeta, useText } from "../api";
import { go } from "../router";
import EmptyState from "../components/EmptyState";
import Staged from "../components/Staged";
import { Card, Kpi, SevBadge, State, sevColor, timeAgo } from "../ui";
import { agentHealth } from "../components/AgentCard";

function Welcome() {
  const t = useText("overview");
  return (
    <EmptyState icon="👋" title={t.welcome_title} action={<>
      <ol className="steps">{(t.welcome_steps ?? []).map((s) => <li key={s}>{s}</li>)}</ol>
      <div className="row">
        <button className="btn primary" onClick={() => go("/integrations", { way: "try" })}>{t.welcome_try}</button>
        <button className="btn" onClick={() => go("/integrations")}>{t.welcome_connect}</button>
      </div>
    </>} />
  );
}

/** Home: four numbers, then agent health, the problems that matter, recent activity and what to do next. Everything is counted from recorded runs. */
export default function Overview() {
  const meta = useMeta(), t = useText("overview"), ov = useApi(paths.overview()), ag = useApi(paths.agents), recent = useApi(paths.traces({ limit: 5 }));
  if (!ov.data) return <State loading={ov.loading} error={ov.error} h={300} onRetry={ov.reload} />;
  const live = ov.data.live, agents = ov.data.agents;
  if (live.total_runs === 0 && agents.registered === 0) return <Welcome />;
  const serious = meta.severities.slice(-2).reduce((n, s) => n + (live.by_severity[s] ?? 0), 0), top = live.recent_incidents.slice(0, 3), list = ag.data?.items ?? [], runs = recent.data?.items ?? [];
  const tile = (k, value, sub, extra = {}) => <Kpi label={t[k].label} value={value} sub={sub} hint={t[k].hint} {...extra} />;
  return (
    <div className="stack">
      <Staged>
        <div key="tiles" className="kpis big">
          {tile("tile_agents", agents.connected, fill(t.tile_agents.sub, { n: agents.registered }), { onClick: () => go("/agents") })}
          {tile("tile_tasks", live.successful_runs, fill(t.tile_tasks.sub, { total: live.total_runs }), { tone: "var(--good)", onClick: () => go("/traces") })}
          {tile("tile_problems", serious, t.tile_problems.sub, { tone: serious ? sevColor("high") : undefined, onClick: () => go("/problems") })}
          {tile("tile_waiting", live.pending_approvals, t.tile_waiting.sub, { tone: live.pending_approvals ? sevColor("medium") : undefined, onClick: () => go("/approvals") })}
        </div>
        {ov.data.suggestions.length > 0 && <Card key="next" title={t.next_title} sub={t.next_sub}>
          <ul className="nexts">{ov.data.suggestions.map((s) => <li key={s.key}><span>{fill(t.suggestions[s.key]?.text, { n: s.n })}</span><button className="btn sm" onClick={() => go(s.path)}>{t.suggestions[s.key]?.cta}</button></li>)}</ul>
        </Card>}
        <div key="two" className="grid-2">
          <Card title={t.health_title} sub={t.health_sub} right={<button className="btn sm" onClick={() => go("/agents")}>{t.health_all}</button>}>
            {list.length === 0 ? <p className="muted">{t.health_empty}</p> : <ul className="plain health-list">{list.slice(0, 6).map((a) => { const [label, color] = agentHealth(a, meta.ui?.agents); return (
              <li key={a.id}><button className="linkbtn" onClick={() => go("/traces", { agent: a.name })}>{a.name}</button><span className="badge sev" style={{ "--c": color }}>{label}</span><span className="muted small">{a.runs} · {a.flagged_runs}</span></li>); })}</ul>}
          </Card>
          <Card title={t.fix_title} sub={t.fix_sub} right={<button className="btn sm" onClick={() => go("/problems")}>{t.fix_all}</button>}>
            {top.length === 0 ? <p className="muted">{t.fix_empty}</p> : (
              <ul className="incidents">{top.map((r) => (
                <li key={r.trace_id}><a href={"#/traces/" + encodeURIComponent(r.trace_id)} className="incident" style={{ "--c": sevColor(r.max_severity) }}>
                  <SevBadge sev={r.max_severity} /><span className="inc-t">{r.headline}</span>
                  <span className="muted">{r.categories.map((c) => catLabel(meta, c)).join(" · ")} · {timeAgo(r.created_at)}</span><span className="go">{t.fix_open} →</span></a></li>))}</ul>)}
          </Card>
        </div>
        <Card key="activity" title={t.activity_title} sub={t.activity_sub} right={<button className="btn sm" onClick={() => go("/traces")}>{t.activity_all}</button>}>
          {runs.length === 0 ? <p className="muted">{t.activity_empty}</p> : <ul className="plain activity-list">{runs.map((r) => (
            <li key={r.trace_id}><a href={"#/traces/" + encodeURIComponent(r.trace_id)}>{r.headline || r.task || r.trace_id}</a>
              <span className="muted small">{r.agent_name} · {t.outcome[r.outcome] ?? r.outcome} · {r.status === "flagged" ? fill(t.problem_flag, { n: r.n_findings ?? 1 }) : t.no_problem_flag} · {timeAgo(r.created_at)}</span></li>))}</ul>}
        </Card>
      </Staged>
    </div>
  );
}
