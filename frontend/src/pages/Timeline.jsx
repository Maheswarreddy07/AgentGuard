import { useEffect, useState } from "react";
import { api, catLabel, fill, paths, useMeta, useText } from "../api";
import { go } from "../router";
import EmptyState from "../components/EmptyState";
import { Card, Chip, SevBadge, State, timeAgo } from "../ui";

// Which recorded kinds belong to each filter. A pending approval is one that was asked for and never decided.
const FILTERS = { all: () => true, successful: (it) => it.kind === "task_completed", problems: (it) => it.kind === "problem_detected" || it.kind === "task_failed", blocked: (it) => it.kind === "action_blocked" };
const dayKey = (iso) => new Date(iso).toDateString();

/** Activity timeline: what agents did, as it happened. Built from recorded runs, problems, blocked actions, approvals and recoveries. */
export default function Timeline() {
  const t = useText("activity"), meta = useMeta(), [items, setItems] = useState([]), [next, setNext] = useState(0), [state, setState] = useState({ loading: true, error: null }), [filter, setFilter] = useState("all");
  async function more(offset) {
    setState({ loading: true, error: null });
    try { const r = await api(paths.timeline({ runs: 15, offset })); setItems((old) => (offset === 0 ? r.items : [...old, ...r.items])); setNext(r.next_offset); setState({ loading: false, error: null }); }
    catch (e) { setState({ loading: false, error: e.message }); }
  }
  useEffect(() => { more(0); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) {
    if (state.loading || state.error) return <State loading={state.loading} error={state.error} h={240} onRetry={() => more(0)} />;
    return <EmptyState icon="🕒" title={t.empty} />;
  }
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 864e5).toDateString(), label = (k) => (k === today ? t.today : k === yesterday ? t.yesterday : new Date(k).toLocaleDateString());
  const decided = new Set(items.filter((i) => i.kind === "approval_decided").map((i) => i.trace_id + "|" + i.tool));
  const keep = filter === "approvals" ? (it) => it.kind === "approval_requested" && !decided.has(it.trace_id + "|" + it.tool) : FILTERS[filter], shown = items.filter(keep);
  const days = shown.reduce((acc, it) => { const k = dayKey(it.ts); (acc[k] ??= []).push(it); return acc; }, {});
  const sentence = (it) => fill(t.kinds[it.kind], { agent: it.agent, tool: it.tool, status: t.status?.[it.status] ?? it.status, by: it.by, category: it.category ? catLabel(meta, it.category) : "", result: it.ok ? t.recovery_ok : t.recovery_failed });
  return (
    <div className="stack">
      <p className="lead">{t.intro}</p>
      <div className="chips" role="group" aria-label={t.filters.all}>{Object.keys(t.filters).map((k) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{t.filters[k]}</Chip>)}</div>
      {shown.length === 0 && <p className="muted">{t.filter_empty}</p>}
      {Object.entries(days).map(([day, list]) => (
        <Card key={day} title={label(day)}>
          <ol className="timeline">{list.map((it, i) => (
            <li key={day + i} className={"tl " + it.kind}>
              <span className="tl-i" aria-hidden="true">{t.icons?.[it.kind]}</span>
              <div className="tl-b">
                <div className="tl-t">{sentence(it)} {it.severity && <SevBadge sev={it.severity} />} {it.resolved && <span className="badge">{t.resolved}</span>}</div>
                {(it.task || it.rule) && <div className="muted small">{it.task ?? fill(t.rule, { rule: it.rule })}</div>}
                <div className="muted small">{timeAgo(it.ts)} · <button className="linkbtn" onClick={() => go("/traces/" + encodeURIComponent(it.trace_id))}>{t.details} →</button></div>
              </div>
            </li>))}</ol>
        </Card>))}
      <div className="row">{next != null ? <button className="btn" disabled={state.loading} onClick={() => more(next)}>{state.loading ? "…" : t.earlier}</button> : <span className="muted">{t.end}</span>}</div>
    </div>
  );
}
