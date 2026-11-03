import { useEffect, useState } from "react";
import { api, catLabel, useApi, useAuth, useMeta } from "../api";
import { go } from "../router";
import { Card, Chip, Empty, MiniStrip, State, sevColor, GOOD, timeAgo, Caption } from "../ui";
const LIMIT = 10;

export default function Traces({ params }) {
  const meta = useMeta(), { can } = useAuth();
  const p = { q: "", status: "", severity: "", category: "", agent: "", sort: "newest", page: "0", ...params };
  const set = (k, v) => go("/traces", { ...p, [k]: v, ...(k !== "page" ? { page: "" } : {}) });
  const [qq, setQq] = useState(p.q);
  useEffect(() => { const t = setTimeout(() => qq !== p.q && set("q", qq), 350); return () => clearTimeout(t); }, [qq]); // eslint-disable-line
  const page = Number(p.page) || 0, keys = ["q", "status", "severity", "category", "agent", "outcome"];
  const qs = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT, sort: p.sort, ...Object.fromEntries(keys.filter((k) => p[k]).map((k) => [k, p[k]])) }).toString();
  const list = useApi(`/api/v1/traces?${qs}`), fac = useApi("/api/v1/traces/facets");
  const f = fac.data, active = keys.filter((k) => p[k]);
  const [busy, setBusy] = useState(false);
  async function seed() { setBusy(true); try { await api("/api/v1/demo/seed", { method: "POST" }); list.reload(); fac.reload(); } finally { setBusy(false); } }
  if (f && f.total === 0) return <Empty title="No traces yet" icon="📭"><p className="muted">Send traces from your agent with the SDK, or explore with synthetic demo data.</p><button className="btn primary" disabled={busy || !can("member")} onClick={seed}>Load demo data</button></Empty>;
  const sevs = [...meta.severities].reverse(), sevTotal = sevs.reduce((n, s) => n + (f?.severity[s] ?? 0), 0);
  const topCats = f ? Object.entries(f.category).sort((a, b) => b[1] - a[1]).slice(0, 5) : [], maxCat = topCats[0]?.[1] || 1;
  const pill = (k) => ({ outcome: `Outcome: ${p.outcome}`, q: `Search: “${p.q}”`, status: p.status === "flagged" ? "Flagged only" : "Healthy only", severity: `Severity: ${p.severity}`, category: catLabel(meta, p.category), agent: `Agent: ${p.agent}` })[k];
  return (
    <div className="stack">
      {f && (
        <div className="triage">
          <div className="kpis">
            {[["", "All runs", f.total, "var(--acc)"], ["flagged", "Flagged", f.flagged, sevColor("high")], ["clean", "Healthy", f.clean, GOOD]].map(([v, l, n, c]) => (
              <button key={l} className={"kpi clickable" + (p.status === v ? " active" : "")} style={{ "--c": c }} onClick={() => set("status", v)}><span className="kpi-l">{l}</span><span className="kpi-v">{n}</span></button>))}
          </div>
          <Card title="Severity mix" className="mix">
            <div className="stackbar" role="group" aria-label="Runs by severity">{sevs.map((s) => (f.severity[s] ? <button key={s} className={p.severity === s ? "on" : ""} style={{ flexGrow: f.severity[s], background: sevColor(s) }} onClick={() => set("severity", p.severity === s ? "" : s)} title={`${s}: ${f.severity[s]} runs`}>{f.severity[s]}</button> : null))}</div>
            <div className="sev-legend">{sevs.map((s) => <span key={s}><i style={{ background: sevColor(s) }} />{s} ({f.severity[s] ?? 0})</span>)}</div>
            {sevTotal === 0 && <p className="muted">No problems found.</p>}
          </Card>
          <Card title="Most common problems" className="mix">
            {topCats.map(([k, n]) => <button key={k} className={"minibar" + (p.category === k ? " on" : "")} onClick={() => set("category", p.category === k ? "" : k)}><span>{catLabel(meta, k)}</span><i style={{ width: (n / maxCat) * 100 + "%" }} /><b>{n}</b></button>)}
          </Card>
        </div>)}

      <Card>
        <div className="filters">
          <label className="field grow">Search by run ID<input value={qq} onChange={(e) => setQq(e.target.value)} placeholder="type part of an ID…" /></label>
          <label className="field">Order<select value={p.sort} onChange={(e) => set("sort", e.target.value)}><option value="newest">Newest first</option><option value="severity">Most severe first</option><option value="events">Longest runs first</option><option value="risk">Riskiest first</option></select></label>
          {f && <label className="field">Agent<select value={p.agent} onChange={(e) => set("agent", e.target.value)}><option value="">All agents</option>{Object.keys(f.agent).map((a) => <option key={a}>{a}</option>)}</select></label>}
          {f && <label className="field">Outcome<select value={p.outcome} onChange={(e) => set("outcome", e.target.value)}><option value="">Any outcome</option>{Object.entries(f.outcome).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}</select></label>}
          {f && <label className="field">Problem<select value={p.category} onChange={(e) => set("category", e.target.value)}><option value="">Any problem</option>{Object.entries(f.category).map(([k, n]) => <option key={k} value={k}>{catLabel(meta, k)} ({n})</option>)}</select></label>}
        </div>
        {active.length > 0 && <div className="chips"><span className="muted">Showing only:</span>{active.map((k) => <Chip key={k} active onRemove onClick={() => { if (k === "q") setQq(""); set(k, ""); }}>{pill(k)}</Chip>)}<button className="linkbtn" onClick={() => { setQq(""); go("/traces"); }}>Clear all</button></div>}
      </Card>

      <State loading={list.loading && !list.data} error={list.error} h={200} />
      {list.data && (list.data.items.length === 0 ? <Empty title="No runs match these filters" icon="🔍"><button className="btn" onClick={() => { setQq(""); go("/traces"); }}>Clear filters</button></Empty> : (<>
        <ul className="trace-list">{list.data.items.map((t) => {
          const bad = t.max_severity, c = bad ? sevColor(bad) : GOOD;
          return (
            <li key={t.trace_id}><a className="trace-card" href={"#/traces/" + t.trace_id} style={{ "--c": c }}>
              <span className="tc-ico" aria-hidden="true">{bad ? "!" : "✓"}</span>
              <div className="tc-main">
                <div className="tc-top"><b className="mono">{t.trace_id}</b><span className="row"><span className="badge">{t.outcome}</span>{t.risk_score > 0 && <span className="badge" title="Highest risk score reached">risk {t.risk_score}</span>}{t.blocked_actions > 0 && <span className="badge" style={{ color: "var(--bad)" }}>{t.blocked_actions} blocked</span>}<span className="badge sev" style={{ "--c": c }}>{bad ?? "healthy"}</span></span></div>
                {t.task && <div className="muted small">Task: {t.task}</div>}
                <div className="tc-head">{t.headline ?? "No issues detected — this run looks healthy."}</div>
                <MiniStrip steps={t.preview} />
                <div className="tc-meta">{t.categories.map((k) => <span key={k} className="tag">{catLabel(meta, k)}</span>)}<span className="muted">{t.n_events} steps · {t.agent_name}{t.mode ? ` · ${t.mode} mode` : ""} · {timeAgo(t.created_at)}</span></div>
              </div>
              <span className="go">Open →</span>
            </a></li>);
        })}</ul>
        <Caption>Each little square under a run is one step, left to right. Red squares are steps where something went wrong.</Caption>
        <div className="pager"><span className="muted">Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, list.data.total)} of {list.data.total}</span>
          <button className="btn" disabled={page === 0} onClick={() => set("page", String(page - 1))}>← Previous</button>
          <button className="btn" disabled={(page + 1) * LIMIT >= list.data.total} onClick={() => set("page", String(page + 1))}>Next →</button></div></>))}
    </div>
  );
}
