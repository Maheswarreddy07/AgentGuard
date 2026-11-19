import { useEffect, useRef, useState } from "react";
import { fill } from "../hooks/context";

/**
 * Top bar with a three-line menu button. The menu lists only the pages this person may open.
 * `groups` = [{ label, items: [{ path, icon, label }] }]; `badges` = { [path]: number }; `text` = the server's shell text.
 */
const ICON = { system: "🖥", light: "☀", dark: "🌙" };
const NEXT = { system: "light", light: "dark", dark: "system" };

export default function AppMenu({ groups, active, title, onNavigate, user, roleName, authRequired, onSignOut, apiStatus, badges = {}, text: t = {}, theme = "system", onTheme, scope = "production", onScope }) {
  const [open, setOpen] = useState(false), btn = useRef(null), panel = useRef(null), total = Object.values(badges).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    window.addEventListener("keydown", esc); panel.current?.querySelector("button")?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const pick = (p) => { setOpen(false); onNavigate(p); };
  const status = apiStatus === "checking" ? t.api_checking : apiStatus === "up" ? t.api_up : t.api_down;
  return (
    <>
      <header className="topbar">
        <button ref={btn} className="burger" aria-label={open ? t.menu_close : t.menu_open} aria-expanded={open} aria-controls="app-menu" onClick={() => setOpen(!open)}>
          <i /><i /><i />{total > 0 && <span className="burger-b" aria-label={fill(t.waiting, { n: total })}>{total}</span>}
        </button>
        <span className="brand"><span className="logo" aria-hidden="true">🛡</span> {t.brand}</span>
        <span className="top-title">{title}</span>
        <span className="top-right">{onTheme && <button className="theme-btn" onClick={() => onTheme(NEXT[theme])} aria-label={`${t.theme_label}: ${t.theme?.[theme]}`} title={`${t.theme_label}: ${t.theme?.[theme]}`}>{ICON[theme]}</button>}<span className={"dot " + (apiStatus === "up" ? "up" : apiStatus === "down" ? "down" : "")} title={status} role="img" aria-label={status} /><span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span></span>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside id="app-menu" ref={panel} className={"menu-panel" + (open ? " open" : "")} aria-hidden={!open} {...(open ? {} : { inert: "" })} aria-label={t.menu_title}>
        <nav aria-label={t.menu_title}>
          {groups.map((g) => (
            <div key={g.label} className="nav-group">
              <div className="nav-h">{g.label}</div>
              {g.items.map((it) => (
                <button key={it.path} className={"nav" + (it.path === active ? " on" : "")} aria-current={it.path === active ? "page" : undefined} onClick={() => pick(it.path)}>
                  <span aria-hidden="true">{it.icon}</span>{it.label}
                  {badges[it.path] > 0 && <span className="nav-b" aria-label={fill(t.waiting, { n: badges[it.path] })}>{badges[it.path]}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me"><span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span><div><div className="me-n">{user.name || user.email}</div><div className="muted small">{authRequired ? roleName : t.local_mode}</div></div></div>
          {authRequired && <button className="btn" onClick={onSignOut}>{t.sign_out}</button>}
          {onScope && <div className="scope-switch" role="group" aria-label={t.scope?.label}>{["production", "synthetic"].map((k) => <button key={k} className={"chip" + (scope === k ? " on" : "")} aria-pressed={scope === k} onClick={() => onScope(k)}>{t.scope?.[k]}</button>)}</div>}
          <div className="status-line"><span className={"dot " + (apiStatus === "up" ? "up" : apiStatus === "down" ? "down" : "")} />{status}</div>
        </div>
      </aside>
    </>
  );
}
