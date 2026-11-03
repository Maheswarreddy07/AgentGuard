import { useCallback, useEffect, useState } from "react";
import { AuthCtx, MetaCtx, api, getToken, roleLabel, setToken, useApi } from "./api";
import { go, useRoute } from "./router";
import { ToastProvider, applyTheme, Skeleton } from "./ui";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Traces from "./pages/Traces";
import TraceDetail from "./pages/TraceDetail";
import History from "./pages/History";
import Risk from "./pages/Risk";
import Policies from "./pages/Policies";
import Approvals from "./pages/Approvals";
import Bench from "./pages/Bench";
import Scenarios from "./pages/Scenarios";
import Settings from "./pages/Settings";

const NAV = [
  ["/overview", "◉", "Overview", "How healthy your agents are right now"],
  ["/traces", "☰", "Agent Runs", "Every agent run, and what went wrong in it"],
  ["/risk", "📈", "Risk Monitor", "Runs that look like they are heading for trouble, and how often the warnings were right"],
  ["/policies", "🛡", "Policy Center", "The rules agents must follow, checked before every action"],
  ["/approvals", "✋", "Approvals", "Actions waiting for a person to say yes or no"],
  ["/history", "🕘", "History", "What happened, who did it, and how results changed over time"],
  ["/bench", "⚗", "Benchmark Lab", "Test AgentGuard against cases with known answers"],
  ["/scenarios", "❖", "Scenarios", "The test cases behind the benchmark"],
  ["/settings", "⚙", "Settings", "Everything you can configure, explained"],
];

function Shell({ user, logout, authRequired }) {
  const { path, params } = useRoute();
  const meta = useApi("/api/v1/meta"), health = useApi("/health"), pend = useApi("/api/v1/approvals?status=pending&limit=1");
  useEffect(() => { const t = setInterval(pend.reload, 15000); return () => clearInterval(t); }, [pend.reload]);
  const rank = (r) => (meta.data?.roles ?? []).findIndex((x) => x.key === r);
  const can = useCallback((min) => rank(user.role) >= rank(min), [user.role, meta.data]); // eslint-disable-line
  const section = "/" + (path.split("/")[1] || "overview");
  const cur = NAV.find((n) => n[0] === section) ?? NAV[0];
  const ok = health.data?.status === "ok", detail = path.startsWith("/traces/");
  if (!meta.data) return <div className="boot"><Skeleton h={200} />{meta.error && <div role="alert" className="alert">{meta.error}</div>}</div>;
  applyTheme(meta.data);
  let page;
  if (detail) page = <TraceDetail id={decodeURIComponent(path.slice(8))} />;
  else if (section === "/traces") page = <Traces params={params} />;
  else if (section === "/risk") page = <Risk />;
  else if (section === "/policies") page = <Policies />;
  else if (section === "/approvals") page = <Approvals />;
  else if (section === "/history") page = <History params={params} />;
  else if (section === "/bench") page = <Bench params={params} />;
  else if (section === "/scenarios") page = <Scenarios />;
  else if (section === "/settings") page = <Settings params={params} />;
  else page = <Overview />;
  return (
    <MetaCtx.Provider value={meta.data}>
      <AuthCtx.Provider value={{ user, can, logout, authRequired }}>
        <div className="app">
          <aside className="side">
            <div className="brand"><span className="logo">🛡</span> AgentGuard</div>
            <nav aria-label="Main">{NAV.map(([p, icon, label]) => <button key={p} className={"nav" + (p === section ? " on" : "")} aria-current={p === section ? "page" : undefined} onClick={() => go(p)}><span aria-hidden="true">{icon}</span>{label}{p === "/approvals" && pend.data?.pending > 0 && <span className="nav-b" aria-label={`${pend.data.pending} waiting`}>{pend.data.pending}</span>}</button>)}</nav>
            <div className="side-foot">
              <div className="me"><span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span>
                <div><div className="me-n">{user.name || user.email}</div><div className="muted small">{authRequired ? roleLabel(meta.data, user.role) : "Local mode — sign-in is off"}</div></div></div>
              {authRequired && <button className="btn" onClick={logout}>Sign out</button>}
              <div className="status-line"><span className={"dot " + (ok ? "up" : "down")} />{health.loading ? "Checking…" : ok ? "API connected" : "API unreachable"}</div>
            </div>
          </aside>
          <main>
            <header className="page-h"><h1>{detail ? "Investigation" : cur[2]}</h1><p>{detail ? "What happened, where it went wrong, and what is safe to do next" : cur[3]}</p></header>
            {!health.loading && !ok && <div role="alert" className="alert">Can’t reach the backend. Start it with <code>uvicorn app.main:app --port 8000</code> and refresh.</div>}
            {page}
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
      const s = await api("/api/v1/auth/status"); setStatus(s);
      if (!s.auth_required) setUser({ email: "local", name: "Local mode", role: "admin" });
      else if (getToken()) { try { setUser(await api("/api/v1/auth/me")); } catch { setToken(null); } }
    } catch (e) { setFatal(e.message); } finally { setBoot(false); }
  }, []);
  useEffect(() => { start(); }, [start]);
  useEffect(() => { const f = () => { setToken(null); setUser(null); setNotice("Your session ended. Please sign in again."); }; window.addEventListener("ag-unauth", f); return () => window.removeEventListener("ag-unauth", f); }, []);
  const logout = async () => { try { await api("/api/v1/auth/logout", { method: "POST" }); } catch { /* already signed out */ } setToken(null); setUser(null); setNotice(null); window.location.hash = "/overview"; };
  if (boot) return <div className="boot"><Skeleton h={160} /></div>;
  if (fatal) return <div className="boot"><div role="alert" className="alert">Can’t reach the backend: {fatal}<br />Start it with <code>uvicorn app.main:app --port 8000</code>, then <button className="linkbtn" onClick={start}>try again</button>.</div></div>;
  return (
    <ToastProvider>
      {status.setup_required ? <Login mode="setup" status={status} onAuthed={(u) => { setStatus((st) => ({ ...st, setup_required: false })); setUser(u); }} />
        : !user ? <Login mode="login" status={status} notice={notice} onAuthed={(u) => { setNotice(null); setUser(u); }} />
        : <Shell user={user} logout={logout} authRequired={status.auth_required} />}
    </ToastProvider>
  );
}
