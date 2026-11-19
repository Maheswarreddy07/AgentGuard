import { useEffect, useRef, useState } from "react";
import { fill, useText } from "../hooks/context";

/**
 * A delete button that always asks first. `what` = { title, body } from the server text (placeholders already filled by the caller or via `vars`);
 * `onConfirm` does the deleting and may throw; the dialog shows the error and stays open.
 */
export default function ConfirmDelete({ kind, what, vars, onConfirm, onDone, label, small = true, disabled = false, className = "" }) {
  const t = useText("delete"), copy = what ?? t[kind] ?? {}, [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(null), yes = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", esc); yes.current?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [open, busy]);
  async function go() {
    setBusy(true); setErr(null);
    try { await onConfirm(); setOpen(false); onDone?.(); } catch (e) { setErr(fill(t.failed, { why: e.message })); } finally { setBusy(false); }
  }
  const stop = (e) => e.stopPropagation();
  return (
    <>
      <button className={"btn danger" + (small ? " sm" : "") + " " + className} disabled={disabled} onClick={(e) => { stop(e); setErr(null); setOpen(true); }} title={label ?? copy.button ?? t.button}>🗑 {label ?? copy.button ?? t.button}</button>
      {open && (
        <div className="modal-wrap" onClick={stop}>
          <div className="scrim" style={{ top: 0 }} onClick={() => !busy && setOpen(false)} aria-hidden="true" />
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cd-t" aria-describedby="cd-b">
            <h3 id="cd-t">{fill(copy.title, vars)}</h3>
            <p id="cd-b">{fill(copy.body, vars)}</p>
            <p className="muted small">{t.permanent}</p>
            {err && <div role="alert" className="alert">{err}</div>}
            <div className="row end"><button className="btn" disabled={busy} onClick={() => setOpen(false)}>{t.cancel}</button><button ref={yes} className="btn danger solid" disabled={busy} onClick={go}>{busy ? t.working : t.confirm}</button></div>
          </div>
        </div>
      )}
    </>
  );
}
