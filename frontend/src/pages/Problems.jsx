import { useState } from "react";
import { catLabel, fill, paths, problemApi, regressionApi, useApi, useAuth, useMeta, useText } from "../api";
import { go } from "../router";
import MakeTest from "../components/MakeTest";
import EmptyState from "../components/EmptyState";
import MoreOnScroll from "../components/MoreOnScroll";
import { Card, SevBadge, State, Tabs, sevColor, timeAgo, useToast } from "../ui";

function Answer({ q, children }) { return <div className="qa"><div className="qa-q">{q}</div><div className="qa-a">{children}</div></div>; }

function ProblemCard({ p, onChanged }) {
  const t = useText("problems"), meta = useMeta(), toast = useToast(), { allowed } = useAuth();
  const [more, setMore] = useState(false), [note, setNote] = useState(null), [busy, setBusy] = useState(false);
  const did = p.what_agentguard_did, act = async (fn) => { setBusy(true); try { await fn(); setNote(null); onChanged(); } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); } };
  return (
    <article className="problem" style={{ "--c": sevColor(p.severity) }}>
      <header className="pb-h"><SevBadge sev={p.severity} /><h3>{p.title ?? catLabel(meta, p.category)}</h3><span className={"badge " + (p.confirmed ? "ok" : "")} title={p.confirmed ? t.confirmed_hint : t.possible_hint}>{p.confirmed ? t.confirmed : t.possible}</span><span className="muted small push">{timeAgo(p.detected_at)}</span></header>
      <Answer q={t.q.what}>{p.what_happened}{p.occurrences > 1 && <span className="muted small"> {fill(t.occurrences, { n: p.occurrences })}</span>}</Answer>
      <Answer q={t.q.why}>{p.why_it_matters}</Answer>
      <Answer q={t.q.agent}>{p.agent}</Answer>
      <Answer q={t.q.did}>{fill(t.did[did.key], { tool: did.tool, rule: did.rule })}</Answer>
      <Answer q={t.q.next}><ol className="plain">{p.next_steps.map((s) => <li key={s}>{s}</li>)}</ol></Answer>
      {p.resolved_at && <p className="muted small">{fill(t.resolved_by, { who: p.resolved_by, when: timeAgo(p.resolved_at) })}{p.resolution_note ? ` · ${p.resolution_note}` : ""}</p>}
      {more && <div className="evidence"><div className="muted small mono">{fill(t.rule_label, { rule: p.rule })} · {fill(t.event_label, { id: p.event_id ?? "–" })}</div><p className="muted small">{p.technical_description}</p><pre>{JSON.stringify(p.evidence, null, 1)}</pre></div>}
      {note !== null && <div className="stack"><label className="field">{t.note_label}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.note_placeholder} maxLength={500} /></label>
        <div className="row"><button className="btn primary sm" disabled={busy} onClick={() => act(() => problemApi.resolve(p.id, note))}>{t.save}</button><button className="btn sm" onClick={() => setNote(null)}>{t.cancel}</button></div></div>}
      <footer className="row">
        <button className="btn sm" onClick={() => go("/traces/" + encodeURIComponent(p.trace_id))}>{t.open_run}</button>
        {allowed("add_scenario") && <MakeTest traceId={p.trace_id} preview={regressionApi.preview} create={regressionApi.create} />}
        <button className="linkbtn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? t.evidence_hide : t.evidence_show}</button>
        {allowed("resolve_problems") && (p.resolved_at ? <button className="btn sm" disabled={busy} onClick={() => act(() => problemApi.reopen(p.id))}>{t.reopen}</button> : note === null && <button className="btn sm" onClick={() => setNote("")}>{t.resolve}</button>)}
      </footer>
    </article>
  );
}

/** Problems: grouped into Critical, Warnings and Resolved. Every problem answers the same five questions. */
export default function Problems({ params }) {
  const t = useText("problems"), [group, setGroup] = useState("critical"), agent = params?.agent || undefined, list = useApi(paths.problems({ group, agent, limit: 100 })), all = useApi(paths.problems({ agent, limit: 1 }));
  const counts = all.data?.counts ?? list.data?.counts ?? {}, reload = () => { list.reload(); all.reload(); };
  return (
    <div className="stack">
      <p className="lead">{t.intro}</p>
      {agent && <div className="callout row"><span>{fill(t.agent_filter, { agent })}</span><button className="linkbtn" onClick={() => go("/problems")}>{t.clear_filter}</button></div>}
      <Tabs value={group} onChange={setGroup} tabs={["critical", "warning", "resolved"].map((k) => ({ key: k, label: t.tabs[k], badge: counts[k] ?? 0 }))} />
      <State loading={list.loading && !list.data} error={list.error} h={180} onRetry={list.reload} />
      {list.data && (list.data.items.length === 0
        ? <EmptyState icon="✅" title={(counts.critical ?? 0) + (counts.warning ?? 0) + (counts.resolved ?? 0) === 0 ? t.empty_none : t.empty_group[group]} />
        : <MoreOnScroll items={list.data.items} step={10}>{(rows) => <div className="problems">{rows.map((p) => <ProblemCard key={p.id} p={p} onChanged={reload} />)}</div>}</MoreOnScroll>)}
    </div>
  );
}
