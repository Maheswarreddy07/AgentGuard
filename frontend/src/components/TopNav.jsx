import { useEffect, useRef, useState } from "react";
import { fill } from "../hooks/context";

const ICON = { system: "🖥", light: "☀", dark: "🌙" };
const NEXT = { system: "light", light: "dark", dark: "system" };

/** Everything about the person: pages only they can open, and sign out. Used in the account menu and the mobile menu. */
function Account({ user, roleName, authRequired, profile, onSignOut, onPick, t }) {
  return (
    <div className="account">
      <div className="me"><span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span><div><div className="me-n">{user.name || user.email}</div><div className="muted small">{authRequired ? roleName : t.local_mode}</div></div></div>
      <button className="nav" onClick={() => onPick("/settings?tab=account")}><span aria-hidden="true">👤</span>{t.my_account}</button>
      <button className="nav" onClick={() => onPick("/settings?tab=keys")}><span aria-hidden="true">🔌</span>{t.connection_settings}</button>
      {profile.map((it) => <button key={it.path} className="nav" onClick={() => onPick(it.path)}><span aria-hidden="true">{it.icon}</span>{it.label}</button>)}
      {authRequired && <button className="btn" onClick={onSignOut}>{t.sign_out}</button>}
    </div>
  );
}

/**
 * The horizontal navigation: logo, six sections in the middle, connection / theme / account on the right.
 * On narrow screens the sections move into a menu. `sections` = [{ key, label, tabs: [{ path, label }] }], `profile` = pages in the account menu, `badges` = { [path]: n }.
 */
export default function TopNav({ sections, profile, activeSection, activePath, onNavigate, user, roleName, authRequired, onSignOut, apiStatus, badges = {}, text: t = {}, theme = "system", onTheme }) {
  const [menu, setMenu] = useState(false), [acct, setAcct] = useState(false), burger = useRef(null), panel = useRef(null);
  const count = (sec) => sec.tabs.reduce((n, tab) => n + (badges[tab.path] ?? 0), 0), total = sections.reduce((n, s) => n + count(s), 0);
  useEffect(() => {
    if (!menu && !acct) return undefined;
    const esc = (e) => { if (e.key === "Escape") { setMenu(false); setAcct(false); burger.current?.focus(); } };
    window.addEventListener("keydown", esc); if (menu) panel.current?.querySelector("button")?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [menu, acct]);
  const pick = (path) => { setMenu(false); setAcct(false); onNavigate(path); };
  const status = apiStatus === "checking" ? t.api_checking : apiStatus === "up" ? t.api_up : t.api_down, dot = "dot " + (apiStatus === "up" ? "up" : apiStatus === "down" ? "down" : "");
  const account = <Account {...{ user, roleName, authRequired, profile, onSignOut, t }} onPick={pick} />;
  return (
    <>
      <header className="topbar">
        <button ref={burger} className="burger" aria-label={menu ? t.menu_close : t.menu_open} aria-expanded={menu} aria-controls="app-menu" onClick={() => { setAcct(false); setMenu(!menu); }}>
          <i /><i /><i />{total > 0 && <span className="burger-b" aria-label={fill(t.waiting, { n: total })}>{total}</span>}
        </button>
        <button className="brand brand-btn" onClick={() => pick("/overview")}><span className="logo" aria-hidden="true">🛡</span> {t.brand}</button>
        <nav className="topnav" aria-label={t.nav_label}>
          {sections.map((s) => <button key={s.key} className={"topnav-i" + (s.key === activeSection ? " on" : "")} aria-current={s.key === activeSection ? "page" : undefined} onClick={() => pick(s.tabs[0].path)}>
            {s.label}{count(s) > 0 && <span className="nav-b" aria-label={fill(t.waiting, { n: count(s) })}>{count(s)}</span>}</button>)}
        </nav>
        <span className="top-right">
          <span className="conn" title={status}><span className={dot} role="img" aria-label={status} /><span className="conn-t">{status}</span></span>
          {onTheme && <button className="theme-btn" onClick={() => onTheme(NEXT[theme])} aria-label={`${t.theme_label}: ${t.theme?.[theme]}`} title={`${t.theme_label}: ${t.theme?.[theme]}`}>{ICON[theme]}</button>}
          <button className="avatar acct-btn" aria-label={t.profile_label} aria-haspopup="true" aria-expanded={acct} onClick={() => { setMenu(false); setAcct(!acct); }}>{(user.name || user.email)[0].toUpperCase()}</button>
        </span>
      </header>
      {(menu || acct) && <div className="scrim" onClick={() => { setMenu(false); setAcct(false); }} aria-hidden="true" />}
      {acct && <div className="acct-menu" role="dialog" aria-label={t.profile_label}>{account}</div>}
      <aside id="app-menu" ref={panel} className={"menu-panel" + (menu ? " open" : "")} aria-hidden={!menu} {...(menu ? {} : { inert: "" })} aria-label={t.menu_title}>
        <nav aria-label={t.menu_title}>
          {sections.map((s) => (
            <div key={s.key} className="nav-group"><div className="nav-h">{s.label}</div>
              {s.tabs.map((tab) => <button key={tab.path} className={"nav" + (tab.path === activePath ? " on" : "")} aria-current={tab.path === activePath ? "page" : undefined} onClick={() => pick(tab.path)}>
                <span aria-hidden="true">{tab.icon}</span>{tab.label}{badges[tab.path] > 0 && <span className="nav-b" aria-label={fill(t.waiting, { n: badges[tab.path] })}>{badges[tab.path]}</span>}</button>)}
            </div>))}
        </nav>
        <div className="side-foot">{account}<div className="status-line"><span className={dot} />{status}</div></div>
      </aside>
    </>
  );
}
