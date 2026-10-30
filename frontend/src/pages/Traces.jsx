import { useEffect, useState } from "react";
import { api, catLabel, useApi, useMeta } from "../api";
import { go } from "../router";
import { Card, Chip, Empty, SEV, SevBadge, State, timeAgo } from "../ui";
const LIMIT = 12;

export default function Traces({ params }) {
  const meta = useMeta();
  const p = { q: "", status: "", severity: "", category: "", agent: "", sort: "newest", page: "0", ...params };
  const set = (k, v) => go("/traces", { ...p, [k]: v, ...(k !== "page" ? { page: "" } : {}) });
  const [qq, setQq] = useState(p.q);
  useEffect(() => { const t = setTimeout(() => qq !== p.q && set("q", qq), 350); return () => clearTimeout(t); }, [qq]); // eslint-disable-line
  const page = Number(p.page) || 0;
  const qs = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT, sort: p.sort, ...Object.fromEntries(["q", "status", "severity", "category", "agent"].filter((k) => p[k]).map((k) => [k, p[k]])) }).toString();
  const list = useApi(`/api/v1/traces?${qs}`), fac = useApi("/api/v1/traces/facets");
  const filtered = ["q", "status", "severity", "category", "agent"].some((k) => p[k]);
  const f = fac.data;
  const [busy, setBusy] = useState(false);
  async function seed() { setBusy(true); try { await api("/api/v1/demo/seed", { method: "POST" }); list.reload(); fac.reload(); } finally { setBusy(false); } }
  if (f && f.total === 0) return <Empty title="No traces yet"><p className="muted">Send traces from your agent with the SDK, or explore with synthetic demo data.</p><button className="btn primary" disabled={busy} onClick={seed}>Load demo data</button></Empty>;
  return (
    <div className="stack">
      <Card>
        <div className="filters">
          <label className="field grow">Search by trace ID<input value={qq} onChange={(e) => setQq(e.target.value)} placeholder="e.g. unauthorized-000" /></label>
          <label className="field">Sort<select value={p.sort} onChange={(e) => set("sort", e.target.value)}><option value="newest">Newest first</option><option value="severity">Most severe first</option><option value="events">Most events</option></select></label>
          {f && <label className="field">Agent<select value={p.agent} onChange={(e) => set("agent", e.target.value)}><option value="">All agents</option>{Object.keys(f.agent).map((a) => <option key={a}>{a}</option>)}</select></label>}
          {f && <label className="field">Problem type<select value={p.category} onChange={(e) => set("category", e.target.value)}><option value="">Any problem</option>{Object.entries(f.category).map(([k, n]) => <option key={k} value={k}>{catLabel(meta, k)} ({n})</option>)}</select></label>}
        </div>
        <div className="chips">
          <span className="muted">Status</span>
          <Chip active={!p.status} onClick={() => set("status", "")}>All{f ? ` (${f.total})` : ""}</Chip>
          <Chip active={p.status === "flagged"} color={SEV.high} onClick={() => set("status", "flagged")}>Flagged{f ? ` (${f.flagged})` : ""}</Chip>
          <Chip active={p.status === "clean"} color="#3ddc97" onClick={() => set("status", "clean")}>Healthy{f ? ` (${f.clean})` : ""}</Chip>
          <span className="muted sp">Severity</span>
          {["critical", "high", "medium", "low"].map((s) => <Chip key={s} active={p.severity === s} color={SEV[s]} onClick={() => set("severity", p.severity === s ? "" : s)}>{s}{f?.severity[s] ? ` (${f.severity[s]})` : ""}</Chip>)}
          {filtered && <button className="linkbtn" onClick={() => { setQq(""); go("/traces"); }}>Clear filters</button>}
        </div>
      </Card>
      <State loading={list.loading && !list.data} error={list.error} h={200} />
      {list.data && (list.data.items.length === 0 ? <Empty title="No runs match these filters"><button className="btn" onClick={() => { setQq(""); go("/traces"); }}>Clear filters</button></Empty> : (
        <>
          <ul className="trace-list">{list.data.items.map((t) => (
            <li key={t.trace_id}><a className="trace-card" href={"#/traces/" + t.trace_id} style={{ "--c": SEV[t.max_severity] ?? "#3ddc97" }}>
              <div className="tc-top"><b>{t.trace_id}</b><SevBadge sev={t.max_severity} /></div>
              <div className="tc-head">{t.headline ?? "No issues detected — this run looks healthy."}</div>
              <div className="tc-meta">{t.categories.map((c) => <span key={c} className="tag">{catLabel(meta, c)}</span>)}<span className="muted">{t.n_events} steps · {t.agent_name} · {timeAgo(t.created_at)}</span></div>
            </a></li>))}</ul>
          <div className="pager"><span className="muted">Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, list.data.total)} of {list.data.total}</span>
            <button className="btn" disabled={page === 0} onClick={() => set("page", String(page - 1))}>← Previous</button>
            <button className="btn" disabled={(page + 1) * LIMIT >= list.data.total} onClick={() => set("page", String(page + 1))}>Next →</button></div>
        </>))}
    </div>
  );
}
