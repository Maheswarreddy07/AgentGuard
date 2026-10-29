import { Bar, BarChart, Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { State, pct, useApi } from "../api";
export function OverviewView({ d, trends = [] }) {
    const cats = Object.entries(d.live.by_category).map(([name, count]) => ({ name, count }));
    return (<>
    <h2>Live traces <span className="badge">live data</span></h2>
    {d.live.total_runs === 0 ? <p className="empty">No traces yet. Submit traces via the SDK or run <code>python -m app.seed</code> to load synthetic demo traces.</p> : (<div className="grid">
        <div className="card"><h3>Total runs</h3><div className="big">{d.live.total_runs}</div></div>
        <div className="card"><h3>Runs with findings</h3><div className="big">{d.live.runs_with_findings}</div></div>
        <div className="card"><h3>Failure rate</h3><div className="big">{pct(d.live.failure_rate)}</div></div>
      </div>)}
    {cats.length > 0 && <div className="card" style={{ height: 280 }}><h3>Findings by category (traces)</h3>
      <ResponsiveContainer width="100%" height="90%"><BarChart data={cats}><XAxis dataKey="name" tick={{ fontSize: 10 }}/><YAxis allowDecimals={false}/><Tooltip /><Bar dataKey="count" fill="#6ea8fe"/></BarChart></ResponsiveContainer></div>}
    <h2>Latest benchmark <span className="badge">synthetic · simulated</span></h2>
    {!d.benchmark ? <p className="empty">No benchmark has been run. Open Benchmark Lab.</p> : (<div className="grid">
        <div className="card"><h3>Precision (micro)</h3><div className="big">{pct(d.benchmark.detection.micro_precision)}</div></div>
        <div className="card"><h3>Recall (micro)</h3><div className="big">{pct(d.benchmark.detection.micro_recall)}</div></div>
        <div className="card"><h3>Recovery success</h3><div className="big">{pct(d.benchmark.recovery.recovery_success_rate)}</div></div>
        <div className="card"><h3>Added latency</h3><div className="big">{d.benchmark.latency_ms.mean_added?.toFixed(3)} ms</div></div>
      </div>)}
    <h2>Trend (live) <span className="badge">live data</span></h2>
    {trends.length === 0 ? <p className="empty">No trend data yet.</p> : <div className="card" style={{ height: 260 }}><h3>Runs and runs with findings per day</h3>
      <ResponsiveContainer width="100%" height="90%"><LineChart data={trends}><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Line dataKey="runs" stroke="#6ea8fe" /><Line dataKey="with_findings" name="with findings" stroke="#ff6b6b" /></LineChart></ResponsiveContainer></div>}
  </>);
}
export default function Overview() {
    const { data, error, loading } = useApi("/api/v1/metrics/overview");
    return <><State loading={loading} error={error}/>{data && <OverviewView d={data}/>}</>;
}
