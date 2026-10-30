import { MetaCtx, useApi } from "./api";
import { go, useRoute } from "./router";
import Overview from "./pages/Overview";
import Traces from "./pages/Traces";
import TraceDetail from "./pages/TraceDetail";
import Bench from "./pages/Bench";
import Scenarios from "./pages/Scenarios";
import Settings from "./pages/Settings";
const NAV = [
  ["/overview", "◉", "Overview", "How healthy your agents are right now"],
  ["/traces", "☰", "Traces", "Every agent run, with what went wrong"],
  ["/bench", "⚗", "Benchmark Lab", "Test AgentGuard against known failures"],
  ["/scenarios", "❖", "Scenarios", "The test cases behind the benchmark"],
  ["/settings", "⚙", "Settings", "Status, limits and how to connect an agent"],
];
export default function App() {
  const { path, params } = useRoute();
  const meta = useApi("/api/v1/meta"), health = useApi("/health");
  const section = "/" + (path.split("/")[1] || "overview");
  const cur = NAV.find((n) => n[0] === section) ?? NAV[0];
  const ok = health.data?.status === "ok";
  let page;
  if (path.startsWith("/traces/")) page = <TraceDetail id={decodeURIComponent(path.slice(8))} />;
  else if (section === "/traces") page = <Traces params={params} />;
  else if (section === "/bench") page = <Bench />;
  else if (section === "/scenarios") page = <Scenarios />;
  else if (section === "/settings") page = <Settings />;
  else page = <Overview />;
  return (
    <MetaCtx.Provider value={meta.data ?? { categories: {}, metrics: {}, actions: {}, severities: [] }}>
      <div className="app">
        <aside className="side">
          <div className="brand"><span className="logo">🛡</span> AgentGuard</div>
          <nav aria-label="Main">
            {NAV.map(([p, icon, label]) => (
              <button key={p} className={"nav" + (p === section ? " on" : "")} aria-current={p === section ? "page" : undefined} onClick={() => go(p)}><span aria-hidden="true">{icon}</span>{label}</button>
            ))}
          </nav>
          <div className="side-foot"><span className={"dot " + (ok ? "up" : "down")} />{health.loading ? "Checking…" : ok ? "API connected" : "API unreachable"}</div>
        </aside>
        <main>
          <header className="page-h"><h1>{path.startsWith("/traces/") ? "Investigation" : cur[2]}</h1><p>{path.startsWith("/traces/") ? "What happened, where it went wrong, and what is safe to do next" : cur[3]}</p></header>
          {!health.loading && !ok && <div role="alert" className="alert">Can’t reach the backend. Start it with <code>uvicorn app.main:app --port 8000</code> and refresh.</div>}
          {page}
        </main>
      </div>
    </MetaCtx.Provider>
  );
}
