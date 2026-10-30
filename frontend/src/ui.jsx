export const SEV = { critical: "#ff5d73", high: "#ff9f43", medium: "#ffd166", low: "#7aa2f7" };
export const GOOD = "#3ddc97", BAD = "#ff5d73", MUTED = "#8b93a7", ACCENT = "#6ea8fe";
export const pct = (v, d = 1) => (v == null ? "n/a" : (v * 100).toFixed(d) + "%");
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
export function SevBadge({ sev }) {
  return sev ? <span className="badge sev" style={{ "--c": SEV[sev] }}>{sev}</span> : <span className="badge sev" style={{ "--c": GOOD }}>clean</span>;
}
export function Info({ text }) {
  return <span className="info" data-tip={text} tabIndex={0} role="img" aria-label={text}>i</span>;
}
export function Card({ title, hint, right, children, className = "" }) {
  return (
    <section className={"card " + className}>
      {(title || right) && <header className="card-h"><h3>{title}{hint && <Info text={hint} />}</h3>{right}</header>}
      {children}
    </section>
  );
}
export function Kpi({ label, value, sub, hint, tone }) {
  return (
    <div className="kpi" style={tone ? { "--c": tone } : undefined}>
      <div className="kpi-l">{label}{hint && <Info text={hint} />}</div>
      <div className="kpi-v">{value}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}
export function Chip({ active, onClick, children, color }) {
  return <button type="button" className={"chip" + (active ? " on" : "")} style={color ? { "--c": color } : undefined} aria-pressed={!!active} onClick={onClick}>{children}</button>;
}
export function Empty({ title, children }) {
  return <div className="empty"><div className="empty-t">{title}</div>{children}</div>;
}
export function Skeleton({ h = 120 }) { return <div className="skeleton" style={{ height: h }} aria-hidden="true" />; }
export function State({ loading, error, h }) {
  if (loading) return <Skeleton h={h} />;
  if (error) return <div role="alert" className="alert">Something went wrong: {error}</div>;
  return null;
}
export const chartTip = { contentStyle: { background: "#161a22", border: "1px solid #2a3140", borderRadius: 8, color: "#e8eaf0", fontSize: 12 }, cursor: { fill: "rgba(110,168,254,.08)" } };
