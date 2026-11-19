import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AuthCtx, MetaCtx, authApi, fill, getToken, paths, roleLabel, setToken, useApi, usePolling } from "./api";
import { go, useRoute } from "./router";
import TopNav from "./components/TopNav";
import SubNav from "./components/SubNav";
import EmptyState from "./components/EmptyState";
import ErrorBoundary from "./components/ErrorBoundary";
import LoadingState from "./components/LoadingState";
import { OFFLINE } from "./config/offline";
import { useTheme } from "./hooks/theme";
import { ToastProvider, applyTheme } from "./ui";
import Login from "./pages/Login";

// Each page is its own download, fetched the first time it is opened.
const page = (load) => lazy(load);
const PAGES = { "/overview": page(() => import("./pages/Overview")), "/agents": page(() => import("./pages/Agents")), "/activity": page(() => import("./pages/Timeline")), "/traces": page(() => import("./pages/Traces")), "/problems": page(() => import("./pages/Problems")), "/risk": page(() => import("./pages/Risk")),
  "/policies": page(() => import("./pages/Policies")), "/approvals": page(() => import("./pages/Approvals")), "/history": page(() => import("./pages/History")), "/run-tests": page(() => import("./pages/RunTests")), "/results": page(() => import("./pages/Results")), "/scenarios": page(() => import("./pages/Scenarios")),
  "/integrations": page(() => import("./pages/Integrations")), "/settings": page(() => import("./pages/Settings")), "/admin": page(() => import("./pages/AdminConsole")) };
const TraceDetail = lazy(() => import("./pages/TraceDetail"));

function Shell({ user, logout, authRequired, shellText }) {
  const { path, params } = useRoute();
  const meta = useApi(paths.meta), health = useApi(paths.health), pending = useApi(paths.approvals({ status: "pending", limit: 1 }));
  usePolling(pending.reload, 15000);
  const [theme, setTheme] = useTheme();
  const access = meta.data?.access, home = access?.home ?? "/overview";
  const rank = (r) => (meta.data?.roles ?? []).findIndex((x) => x.key === r);
  const can = useCallback((min) => rank(user.role) >= rank(min), [user.role, meta.data]); // eslint-disable-line
  const allowed = useCallback((cap) => access?.capabilities?.[cap] === true, [access]);
  const bare = !window.location.hash || window.location.hash === "#" || window.location.hash === "#/";
  useEffect(() => { if (access && bare) go(home); }, [access, bare, home]);
  const section = "/" + (path.split("/")[1] || "overview"), detail = path.startsWith("/traces/");
  const apiStatus = health.loading ? "checking" : health.data?.status === "ok" ? "up" : "down";
  if (!access) return <div className="boot"><LoadingState h={200} error={meta.error} onRetry={meta.reload} /></div>;
  applyTheme(meta.data);
  const tabsOf = [...access.sections.flatMap((s) => s.tabs.map((t) => ({ ...t, section: s.key }))), ...access.profile.map((p) => ({ ...p, section: "profile" }))];
  const nav = tabsOf.find((n) => n.path === (detail ? "/traces" : section)), sectionNow = access.sections.find((s) => s.key === nav?.section), permitted = access.pages.includes(detail ? "/traces" : section), Page = PAGES[section];
  const ui = meta.data.ui ?? {}, sh = ui.shell ?? shellText ?? {}, deny = ui.access ?? {}, mine = meta.data.roles.find((r) => r.key === user.role)?.label ?? user.role;
  const title = detail ? ui.trace?.title ?? nav?.label : nav?.label, sub = detail ? ui.trace?.sub : nav?.subtitle;
  return (
    <MetaCtx.Provider value={meta.data}>
      <AuthCtx.Provider value={{ user, can, allowed, logout, authRequired }}>
        <a className="skip" href="#main">{sh.skip}</a>
        <TopNav sections={access.sections} profile={access.profile} activeSection={nav?.section} activePath={nav?.path} onNavigate={(p) => go(p)} user={user} roleName={roleLabel(meta.data, user.role)} authRequired={authRequired} onSignOut={logout}
          apiStatus={apiStatus} badges={{ "/approvals": pending.data?.pending ?? 0 }} text={sh} theme={theme} onTheme={setTheme} />
        <main id="main">
          {permitted && sectionNow && <SubNav tabs={sectionNow.tabs} activePath={nav?.path} onNavigate={(p) => go(p)} label={sh.subnav_label} badges={{ "/approvals": pending.data?.pending ?? 0 }} />}
          {permitted && Page && <header className="page-h"><h1>{title}</h1>{sub && <p>{sub}</p>}</header>}
          {apiStatus === "down" && <div role="alert" className="alert">{sh.backend_down}</div>}
          <ErrorBoundary key={path} text={sh}>
            <Suspense fallback={<LoadingState h={220} />}>
              {!permitted || !Page ? <EmptyState icon="🔒" title={deny.denied_title} action={<button className="btn primary" onClick={() => go(home)}>{deny.denied_action}</button>}><p className="muted">{fill(deny.denied_body, { role: mine })}</p></EmptyState>
                : detail ? <TraceDetail id={decodeURIComponent(path.slice(8))} /> : <Page params={params} />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </AuthCtx.Provider>
    </MetaCtx.Provider>
  );
}

export default function App() {
  const [status, setStatus] = useState(null), [user, setUser] = useState(null), [boot, setBoot] = useState(true), [fatal, setFatal] = useState(null), [notice, setNotice] = useState(null);
  const start = useCallback(async () => {
    setBoot(true); setFatal(null);
    try {
      const s = await authApi.status(); setStatus(s);
      if (!s.auth_required) setUser({ email: "local", name: OFFLINE.localUser, role: "admin" });
      else if (getToken()) { try { setUser(await authApi.me()); } catch { setToken(null); } }
    } catch (e) { setFatal(e.message); } finally { setBoot(false); }
  }, []);
  useEffect(() => { start(); }, [start]);
  useEffect(() => { const f = () => { setToken(null); setUser(null); setNotice(status?.ui?.login?.session_ended); }; window.addEventListener("ag-unauth", f); return () => window.removeEventListener("ag-unauth", f); }, [status]);
  const logout = async () => { try { await authApi.logout(); } catch { /* already signed out */ } setToken(null); setUser(null); setNotice(null); window.location.hash = ""; };
  if (boot) return <div className="boot"><LoadingState h={160} /></div>;
  if (fatal) return <div className="boot"><div role="alert" className="alert"><b>{OFFLINE.title}</b><p>{OFFLINE.body}</p><button className="btn" onClick={start}>{OFFLINE.retry}</button></div></div>;
  return (
    <ToastProvider>
      {status.setup_required ? <Login mode="setup" status={status} onAuthed={(u) => { setStatus((st) => ({ ...st, setup_required: false })); setUser(u); }} />
        : !user ? <Login mode="login" status={status} notice={notice} onAuthed={(u) => { setNotice(null); setUser(u); }} />
        : <Shell user={user} logout={logout} authRequired={status.auth_required} shellText={status.ui?.shell} />}
    </ToastProvider>
  );
}
