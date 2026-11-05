import { useCallback, useEffect, useState } from "react";
import { AuthCtx, MetaCtx, authApi, getToken, paths, roleLabel, setToken, useApi, usePolling } from "./api";
import { go, useRoute } from "./router";
import { NAV_GROUPS, findNav } from "./config/navigation";
import AppSidebar from "./components/AppSidebar";
import PageHeader from "./components/PageHeader";
import LoadingState from "./components/LoadingState";
import { ToastProvider, applyTheme } from "./ui";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Agents from "./pages/Agents";
import Traces from "./pages/Traces";
import TraceDetail from "./pages/TraceDetail";
import Problems from "./pages/Problems";
import Risk from "./pages/Risk";
import Policies from "./pages/Policies";
import Approvals from "./pages/Approvals";
import History from "./pages/History";
import Bench from "./pages/Bench";
import Scenarios from "./pages/Scenarios";
import Integrations from "./pages/Integrations";
import Settings from "./pages/Settings";

const PAGES = { "/overview": Overview, "/agents": Agents, "/traces": Traces, "/problems": Problems, "/risk": Risk, "/policies": Policies, "/approvals": Approvals, "/history": History, "/bench": Bench, "/scenarios": Scenarios, "/integrations": Integrations, "/settings": Settings };

function Shell({ user, logout, authRequired }) {
  const { path, params } = useRoute();
  const meta = useApi(paths.meta), health = useApi(paths.health), pending = useApi(paths.approvals({ status: "pending", limit: 1 }));
  usePolling(pending.reload, 15000);
  const rank = (r) => (meta.data?.roles ?? []).findIndex((x) => x.key === r);
  const can = useCallback((min) => rank(user.role) >= rank(min), [user.role, meta.data]); // eslint-disable-line
  const section = "/" + (path.split("/")[1] || "overview");
  const detail = path.startsWith("/traces/"), nav = findNav(section), Page = PAGES[section] ?? Overview;
  const apiStatus = health.loading ? "checking" : health.data?.status === "ok" ? "up" : "down";
  if (!meta.data) return <div className="boot"><LoadingState h={200} error={meta.error} onRetry={meta.reload} /></div>;
  applyTheme(meta.data);
  return (
    <MetaCtx.Provider value={meta.data}>
      <AuthCtx.Provider value={{ user, can, logout, authRequired }}>
        <div className="app">
          <AppSidebar groups={NAV_GROUPS} active={section} onNavigate={(p) => go(p)} user={user} roleName={roleLabel(meta.data, user.role)} authRequired={authRequired} onSignOut={logout}
            apiStatus={apiStatus} badges={{ "/approvals": pending.data?.pending ?? 0 }} />
          <main>
            <PageHeader title={detail ? "Investigation" : nav.label} subtitle={detail ? "What happened, where it went wrong, and what is safe to do next" : nav.subtitle} />
            {apiStatus === "down" && <div role="alert" className="alert">Can’t reach the backend. Start it with <code>uvicorn app.main:app --port 8000</code> and refresh.</div>}
            {detail ? <TraceDetail id={decodeURIComponent(path.slice(8))} /> : <Page params={params} />}
          </main>
        </div>
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
      if (!s.auth_required) setUser({ email: "local", name: "Local mode", role: "admin" });
      else if (getToken()) { try { setUser(await authApi.me()); } catch { setToken(null); } }
    } catch (e) { setFatal(e.message); } finally { setBoot(false); }
  }, []);
  useEffect(() => { start(); }, [start]);
  useEffect(() => { const f = () => { setToken(null); setUser(null); setNotice("Your session ended. Please sign in again."); }; window.addEventListener("ag-unauth", f); return () => window.removeEventListener("ag-unauth", f); }, []);
  const logout = async () => { try { await authApi.logout(); } catch { /* already signed out */ } setToken(null); setUser(null); setNotice(null); window.location.hash = "/overview"; };
  if (boot) return <div className="boot"><LoadingState h={160} /></div>;
  if (fatal) return <div className="boot"><div role="alert" className="alert">Can’t reach the backend: {fatal}<br />Start it with <code>uvicorn app.main:app --port 8000</code>, then <button className="linkbtn" onClick={start}>try again</button>.</div></div>;
  return (
    <ToastProvider>
      {status.setup_required ? <Login mode="setup" status={status} onAuthed={(u) => { setStatus((st) => ({ ...st, setup_required: false })); setUser(u); }} />
        : !user ? <Login mode="login" status={status} notice={notice} onAuthed={(u) => { setNotice(null); setUser(u); }} />
        : <Shell user={user} logout={logout} authRequired={status.auth_required} />}
    </ToastProvider>
  );
}
