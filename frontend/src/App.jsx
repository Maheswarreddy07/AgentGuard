import { useState } from "react";
import Overview from "./pages/Overview";
import Traces from "./pages/Traces";
import Bench from "./pages/Bench";
import Scenarios from "./pages/Scenarios";
import Settings from "./pages/Settings";
const PAGES = { Overview, Traces, "Benchmark Lab": Bench, Scenarios, Settings };
export default function App() {
    const [page, setPage] = useState("Overview");
    const P = PAGES[page];
    return (<>
    <nav aria-label="Main"><strong style={{ padding: "8px 12px" }}>AgentGuard</strong>
      {Object.keys(PAGES).map((p) => <button key={p} aria-current={p === page ? "page" : undefined} onClick={() => setPage(p)}>{p}</button>)}
    </nav><main><P /></main></>);
}
