import { useEffect, useState } from "react";
import { catLabel, paths, runApi, useApi, useAuth, useMeta } from "../api";
import ConfirmDelete from "../components/ConfirmDelete";
import { go } from "../router";
import { Card, Chip, Empty, MiniStrip, State, sevColor, GOOD, timeAgo, Caption } from "../ui";
import { useT } from "../hooks/context";
const LIMIT = 10;

export default function Traces({ params }) {
  const txt = useT("traces");
  const meta = useMeta(), { allowed } = useAuth();
  const p = { q: "", status: "", severity: "", category: "", agent: "", sort: "newest", page: "0", ...params };
  const set = (k, v) => go("/traces", { ...p, [k]: v, ...(k !== "page" ? { page: "" } : {}) });
  const [qq, setQq] = useState(p.q);
  useEffect(() => { const t = setTimeout(() => qq !== p.q && set("q", qq), 350); return () => clearTimeout(t); }, [qq]); // eslint-disable-line
  const page = Number(p.page) || 0, keys = ["q", "status", "severity", "category", "agent", "outcome"];
  const list = useApi(paths.traces({ limit: LIMIT, offset: page * LIMIT, sort: p.sort, ...Object.fromEntries(keys.filter((k) => p[k]).map((k) => [k, p[k]])) })), fac = useApi(paths.facets);
  const f = fac.data, active = keys.filter((k) => p[k]);
  if (f && f.total === 0) return <Empty title={txt("no_traces_yet")} icon="📭"><p className="muted">{txt("send_traces_from_your_agent")}</p><button className="btn primary" onClick={() => go("/integrations")}>{txt("connect_agent")}</button></Empty>;
  const sevs = [...meta.severities].reverse(), sevTotal = sevs.reduce((n, s) => n + (f?.severity[s] ?? 0), 0);
  const topCats = f ? Object.entries(f.category).sort((a, b) => b[1] - a[1]).slice(0, 5) : [], maxCat = topCats[0]?.[1] || 1;
  const pill = (k) => ({ outcome: txt("pill_outcome", { v: p.outcome }), q: txt("pill_q", { v: p.q }), status: p.status === "flagged" ? txt("pill_flagged") : txt("pill_healthy"), severity: txt("pill_severity", { v: p.severity }), category: catLabel(meta, p.category), agent: txt("pill_agent", { v: p.agent }) })[k];
  return (
    <div className="stack">
      {f && (
        <div className="triage">
          <div className="kpis">
            {[["", txt("f_all"), f.total, "var(--acc)"], ["flagged", txt("f_flagged"), f.flagged, sevColor("high")], ["clean", txt("f_clean"), f.clean, GOOD]].map(([v, l, n, c]) => (
              <button key={l} className={"kpi clickable" + (p.status === v ? " active" : "")} style={{ "--c": c }} onClick={() => set("status", v)}><span className="kpi-l">{l}</span><span className="kpi-v">{n}</span></button>))}
          </div>
          <Card title={txt("severity_mix")} className="mix">
            <div className="stackbar" role="group" aria-label={txt("runs_by_severity")}>{sevs.map((s) => (f.severity[s] ? <button key={s} className={p.severity === s ? "on" : ""} style={{ flexGrow: f.severity[s], background: sevColor(s) }} onClick={() => set("severity", p.severity === s ? "" : s)} title={txt("s_v2_runs", { s, v2: f.severity[s] })}>{f.severity[s]}</button> : null))}</div>
            <div className="sev-legend">{sevs.map((s) => <span key={s}><i style={{ background: sevColor(s) }} />{s} ({f.severity[s] ?? 0})</span>)}</div>
            {sevTotal === 0 && <p className="muted">{txt("no_problems_found")}</p>}
          </Card>
          <Card title={txt("most_common_problems")} className="mix">
            {topCats.map(([k, n]) => <button key={k} className={"minibar" + (p.category === k ? " on" : "")} onClick={() => set("category", p.category === k ? "" : k)}><span>{catLabel(meta, k)}</span><i style={{ width: (n / maxCat) * 100 + "%" }} /><b>{n}</b></button>)}
          </Card>
        </div>)}

      <Card>
        <div className="filters">
          <label className="field grow">{txt("search_by_run_id")}<input value={qq} onChange={(e) => setQq(e.target.value)} placeholder={txt("type_part_of_an_id")} /></label>
          <label className="field">{txt("order")}<select value={p.sort} onChange={(e) => set("sort", e.target.value)}><option value="newest">{txt("newest_first")}</option><option value="severity">{txt("most_severe_first")}</option><option value="events">{txt("longest_runs_first")}</option><option value="risk">{txt("riskiest_first")}</option></select></label>
          {f && <label className="field">{txt("agent")}<select value={p.agent} onChange={(e) => set("agent", e.target.value)}><option value="">{txt("all_agents")}</option>{Object.keys(f.agent).map((a) => <option key={a}>{a}</option>)}</select></label>}
          {f && <label className="field">{txt("outcome")}<select value={p.outcome} onChange={(e) => set("outcome", e.target.value)}><option value="">{txt("any_outcome")}</option>{Object.entries(f.outcome).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}</select></label>}
          {f && <label className="field">{txt("problem")}<select value={p.category} onChange={(e) => set("category", e.target.value)}><option value="">{txt("any_problem")}</option>{Object.entries(f.category).map(([k, n]) => <option key={k} value={k}>{catLabel(meta, k)} ({n})</option>)}</select></label>}
        </div>
        {active.length > 0 && <div className="chips"><span className="muted">{txt("showing_only")}</span>{active.map((k) => <Chip key={k} active onRemove onClick={() => { if (k === "q") setQq(""); set(k, ""); }}>{pill(k)}</Chip>)}<button className="linkbtn" onClick={() => { setQq(""); go("/traces"); }}>{txt("clear_all")}</button></div>}
      </Card>

      <State loading={list.loading && !list.data} error={list.error} h={200} />
      {list.data && (list.data.items.length === 0 ? <Empty title={txt("no_runs_match_these_filters")} icon="🔍"><button className="btn" onClick={() => { setQq(""); go("/traces"); }}>{txt("clear_filters")}</button></Empty> : (<>
        <ul className="trace-list">{list.data.items.map((t) => {
          const bad = t.max_severity, c = bad ? sevColor(bad) : GOOD;
          return (
            <li key={t.trace_id}><a className="trace-card" href={"#/traces/" + t.trace_id} style={{ "--c": c }}>
              <span className="tc-ico" aria-hidden="true">{bad ? "!" : "✓"}</span>
              <div className="tc-main">
                <div className="tc-top"><b className="mono">{t.trace_id}</b><span className="row"><span className="badge">{t.outcome}</span>{t.risk_score > 0 && <span className="badge" title={txt("highest_risk_score_reached")}>{txt("risk_risk_score", { risk_score: t.risk_score })}</span>}{t.blocked_actions > 0 && <span className="badge" style={{ color: "var(--bad)" }}>{txt("blocked_actions_blocked", { blocked_actions: t.blocked_actions })}</span>}<span className="badge sev" style={{ "--c": c }}>{bad ?? txt("healthy")}</span></span></div>
                {t.task && <div className="muted small">{txt("task_task", { task: t.task })}</div>}
                <div className="tc-head">{t.headline ?? txt("no_issues_detected_this_run")}</div>
                <MiniStrip steps={t.preview} />
                <div className="tc-meta">{t.categories.map((k) => <span key={k} className="tag">{catLabel(meta, k)}</span>)}<span className="muted">{txt("n_events_steps_agent_name", { n_events: t.n_events, agent_name: t.agent_name })}{t.mode ? txt("mode_mode", { mode: t.mode }) : ""} · {timeAgo(t.created_at)}</span></div>
              </div>
              <span className="go">{txt("open")}</span>
            </a>{allowed("delete_data") && <div className="tc-del"><ConfirmDelete kind="run" vars={{ name: t.trace_id }} onConfirm={() => runApi.remove(t.trace_id)} onDone={list.reload} /></div>}</li>);
        })}</ul>
        <Caption>{txt("each_little_square_under_a")}</Caption>
        <div className="pager"><span className="muted">{txt("showing")} {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, list.data.total)} {txt("of_total", { total: list.data.total })}</span>
          <button className="btn" disabled={page === 0} onClick={() => set("page", String(page - 1))}>{txt("previous")}</button>
          <button className="btn" disabled={(page + 1) * LIMIT >= list.data.total} onClick={() => set("page", String(page + 1))}>{txt("next")}</button></div></>))}
    </div>
  );
}
