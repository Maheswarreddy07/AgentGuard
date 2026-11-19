import { useEffect, useRef, useState } from "react";
import { catLabel, fill, useMeta, useText } from "../hooks/context";

/** Turn a real problem into a test. The person sees what is kept and removed and must confirm before anything is saved. */
export default function MakeTest({ traceId, preview, create, onDone }) {
  const t = useText("problems"), meta = useMeta(), [open, setOpen] = useState(false), [pv, setPv] = useState(null), [err, setErr] = useState(null), [ok, setOk] = useState(false), [sure, setSure] = useState(false), [busy, setBusy] = useState(false), first = useRef(null);
  useEffect(() => { if (!open) return undefined; setPv(null); setErr(null); setSure(false); preview(traceId).then(setPv, (e) => setErr(e.message)); const esc = (e) => e.key === "Escape" && !busy && setOpen(false); window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [open]); // eslint-disable-line
  useEffect(() => { if (pv) first.current?.focus(); }, [pv]);
  async function save() { setBusy(true); setErr(null); try { await create(traceId, { confirm_reviewed: true, failure_categories: pv.failure_categories }); setOk(true); onDone?.(); } catch (e) { setErr(fill(t.test_failed, { why: e.message })); } finally { setBusy(false); } }
  if (ok) return <span role="status" className="okt small">{t.test_saved}</span>;
  return (<>
    <button className="btn sm" onClick={() => setOpen(true)}>{t.make_test}</button>
    {open && <div className="modal-wrap"><div className="scrim" style={{ top: 0 }} onClick={() => !busy && setOpen(false)} aria-hidden="true" />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt-t">
        <h3 id="mt-t">{t.test_title}</h3><p>{t.test_intro}</p>
        {err && <p role="alert" className="alert">{err}</p>}
        {pv && <>
          <p className="muted small">{fill(t.test_steps, { n: pv.n_events })}</p>
          <p><b>{t.test_kept}:</b> {pv.kept.join(", ")}.</p><p><b>{t.test_removed}:</b> {pv.removed.join(", ")}.</p>
          {pv.failure_categories.length > 0 ? <p><b>{t.test_catches}</b> {pv.failure_categories.map((c) => catLabel(meta, c)).join(", ")}</p> : <p className="muted">{t.test_none}</p>}
          {pv.not_preserved.length > 0 && <p className="muted small">{fill(t.test_not_preserved, { list: pv.not_preserved.map((c) => catLabel(meta, c)).join(", ") })}</p>}
          <label className="check"><input ref={first} type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> {t.test_confirm}</label>
        </>}
        <div className="row"><button className="btn primary" disabled={!pv || !sure || busy || pv.failure_categories.length === 0} onClick={save}>{t.test_save}</button><button className="btn" disabled={busy} onClick={() => setOpen(false)}>{t.cancel}</button></div>
      </div></div>}
  </>);
}
