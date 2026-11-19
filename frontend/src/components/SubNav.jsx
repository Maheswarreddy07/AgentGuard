/** Tabs for the pages inside the current section (shown only when the section has more than one page). */
export default function SubNav({ tabs, activePath, onNavigate, label, badges = {} }) {
  if (tabs.length < 2) return null;
  return (
    <nav className="subnav" aria-label={label}>
      {tabs.map((t) => <button key={t.path} className={"subnav-i" + (t.path === activePath ? " on" : "")} aria-current={t.path === activePath ? "page" : undefined} onClick={() => onNavigate(t.path)}>{t.label}{badges[t.path] > 0 && <span className="nav-b">{badges[t.path]}</span>}</button>)}
    </nav>
  );
}
