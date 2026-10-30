import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
export const GOOD = "#3ddc97", BAD = "#ff5d73", WARN = "#ff9f43", MUTED = "#8b93a7", ACCENT = "#6ea8fe";
export const SEV = {};   // filled from the backend's /meta by applyTheme — never hardcoded here
export function applyTheme(meta) { for (const k of Object.keys(SEV)) delete SEV[k]; Object.assign(SEV, meta?.severity_colors ?? {}); }
export const sevColor = (s) => SEV[s] ?? MUTED;
export const pct = (v, d = 1) => (v == null ? "n/a" : (v * 100).toFixed(d) + "%");
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
export const when = (iso) => new Date(iso).toLocaleString();

export function SevBadge({ sev }) {
  return sev ? <span className="badge sev" style={{ "--c": sevColor(sev) }}>{sev}</span> : <span className="badge sev" style={{ "--c": GOOD }}>clean</span>;
}
export function Info({ text }) { return <span className="info" data-tip={text} tabIndex={0} role="img" aria-label={text}>i</span>; }
export function Card({ title, hint, right, children, className = "", sub }) {
  return (
    <section className={"card " + className}>
      {(title || right) && <header className="card-h"><div><h3>{title}{hint && <Info text={hint} />}</h3>{sub && <p className="sub">{sub}</p>}</div>{right}</header>}
      {children}
    </section>
  );
}
export const Caption = ({ children }) => <p className="caption"><span aria-hidden="true">💡</span> {children}</p>;
export function Kpi({ label, value, sub, hint, tone, onClick }) {
  const T = onClick ? "button" : "div";
  return (
    <T className={"kpi" + (onClick ? " clickable" : "")} style={tone ? { "--c": tone } : undefined} onClick={onClick}>
      <span className="kpi-l">{label}{hint && <Info text={hint} />}</span><span className="kpi-v">{value}</span>{sub && <span className="kpi-s">{sub}</span>}
    </T>
  );
}
export function Chip({ active, onClick, children, color, onRemove }) {
  return <button type="button" className={"chip" + (active ? " on" : "")} style={color ? { "--c": color } : undefined} aria-pressed={!!active} onClick={onClick}>{children}{onRemove && <span aria-hidden="true"> ×</span>}</button>;
}
export function Empty({ title, children, icon = "🗂" }) { return <div className="empty"><div className="empty-i" aria-hidden="true">{icon}</div><div className="empty-t">{title}</div>{children}</div>; }
export function Skeleton({ h = 120 }) { return <div className="skeleton" style={{ height: h }} aria-hidden="true" />; }
export function State({ loading, error, h }) {
  if (loading) return <Skeleton h={h} />;
  if (error) return <div role="alert" className="alert">Something went wrong: {error}</div>;
  return null;
}
export const chartTip = { contentStyle: { background: "#161a22", border: "1px solid #2a3140", borderRadius: 8, color: "#e8eaf0", fontSize: 12 }, cursor: { fill: "rgba(110,168,254,.08)" } };

export function Toggle({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={"switch" + (checked ? " on" : "")} onClick={() => onChange(!checked)}><i /></button>;
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={"tab" + (value === t.key ? " on" : "")} onClick={() => onChange(t.key)}>{t.label}{t.badge != null && <span className="tab-b">{t.badge}</span>}</button>)}</div>;
}
/** One small square per step; red when something went wrong; ringed at `mark`. */
export function MiniStrip({ steps = [], mark, max = 48 }) {
  const shown = steps.slice(0, max);
  return (
    <div className="strip" aria-label={`${steps.length} steps, ${steps.filter((s) => s.s === "bad").length} with problems`}>
      {shown.map((s, i) => <span key={i} title={`Step ${i}: ${String(s.t).replace(/_/g, " ")}${s.s === "bad" ? " (problem)" : ""}`} className={"sq" + (s.s === "bad" ? " bad" : "") + (i === mark ? " mark" : "")} />)}
      {steps.length > max && <span className="muted">+{steps.length - max}</span>}
    </div>
  );
}
export function Drawer({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-h"><h2 className="mono">{title}</h2><button ref={ref} className="btn" onClick={onClose}>Close ✕</button></header>
        <div className="drawer-b">{children}</div>
      </aside>
    </div>
  );
}
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = "ok") => { const id = Math.random(); setItems((x) => [...x, { id, msg, tone }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" aria-live="polite">{items.map((i) => <div key={i.id} className={"toast " + i.tone} role="status">{i.msg}</div>)}</div></ToastCtx.Provider>;
}
export function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return <button className="btn" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? "Copied ✓" : label}</button>;
}
