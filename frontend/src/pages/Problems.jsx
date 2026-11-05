import { useState } from "react";
import { catLabel, paths, useApi, useMeta } from "../api";
import EmptyState from "../components/EmptyState";
import ProblemCard from "../components/ProblemCard";
import ProblemDetails from "../components/ProblemDetails";
import { Card, Chip, Drawer, State, sevColor } from "../ui";
const PAGE = 15;

function Detail({ id, onClose }) {
  const d = useApi(paths.finding(id)), [sel, setSel] = useState(null);
  const p = d.data;
  return (
    <Drawer title="Problem details" onClose={onClose}>
      {!p ? <State loading={d.loading} error={d.error} h={160} onRetry={d.reload} /> : (<>
        <p className="muted">Found in run <a href={"#/traces/" + p.trace_id} className="mono">{p.trace_id}</a>{p.run.task ? ` — task: ${p.run.task}` : ""}</p>
        <ProblemDetails problem={p} evidenceEvents={p.evidence_events} selectedEventId={sel} onSelectEvent={setSel} stepOf={(eid) => p.context_events.find((e) => e.event_id === eid)?.step_index} />
        {p.localization?.resolved && <p className="muted small">Where it shows up: first detectable at step {p.localization.first_detectable_step}{p.localization.origin_event_id ? "" : " · origin not determinable from the recorded evidence"}.</p>}
        <a className="btn primary" href={"#/traces/" + p.trace_id}>Open the whole run →</a>
      </>)}
    </Drawer>
  );
}

export default function Problems() {
  const meta = useMeta(), [sev, setSev] = useState(""), [cat, setCat] = useState(""), [page, setPage] = useState(0), [open, setOpen] = useState(null);
  const list = useApi(paths.findings({ limit: PAGE, offset: page * PAGE, severity: sev, category: cat }));
  const reset = (f) => (v) => { f(v); setPage(0); };
  return (
    <div className="stack">
      <Card>
        <div className="chips"><span className="muted">Severity</span>
          <Chip active={!sev} onClick={() => reset(setSev)("")}>All</Chip>
          {[...meta.severities].reverse().map((s) => <Chip key={s} active={sev === s} color={sevColor(s)} onClick={() => reset(setSev)(sev === s ? "" : s)}>{s}</Chip>)}
          <label className="field inline"><span className="muted">Kind</span><select value={cat} onChange={(e) => reset(setCat)(e.target.value)}><option value="">Any kind</option>{Object.keys(meta.categories).map((c) => <option key={c} value={c}>{catLabel(meta, c)}</option>)}</select></label>
        </div>
      </Card>
      <State loading={list.loading && !list.data} error={list.error} h={200} onRetry={list.reload} />
      {list.data && (list.data.items.length === 0
        ? <EmptyState icon="✅" title="No problems found" ><p className="muted">{sev || cat ? "Nothing matches these filters." : "Nothing has gone wrong yet."}</p></EmptyState>
        : (<>
          <div className="stack">{list.data.items.map((p) => <ProblemCard key={p.id} problem={p} onOpen={(x) => setOpen(x.id)} />)}</div>
          <div className="pager"><span className="muted">Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, list.data.total)} of {list.data.total}</span>
            <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button><button className="btn" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage(page + 1)}>Next →</button></div></>))}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
