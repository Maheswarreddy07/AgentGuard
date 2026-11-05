import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { BAD, Card, GOOD, Kpi, chartTip, pct, sevColor } from "../ui";

/** Overall health: a donut of healthy vs flagged runs, and the four numbers people look at first. */
export default function HealthSummary({ live, severities = [], onNavigate }) {
  const data = [{ name: "Healthy runs", value: live.clean_runs, c: GOOD }, { name: "Flagged runs", value: live.runs_with_findings, c: BAD }];
  const urgent = ["critical", "high"].reduce((n, s) => n + (live.by_severity[s] ?? 0), 0);
  return (
    <div className="grid-2">
      <Card title="Agent health" sub="Share of runs where no rule found a problem" hint="A run is “flagged” when at least one detection rule fired.">
        <div className="health">
          <div className="donut">
            <ResponsiveContainer width="100%" height={170}><PieChart><Pie data={data} dataKey="value" innerRadius={55} outerRadius={78} stroke="none" paddingAngle={2}>{data.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip {...chartTip} /></PieChart></ResponsiveContainer>
            <div className="donut-c"><b>{pct(1 - (live.failure_rate ?? 0), 0)}</b><span>healthy</span></div>
          </div>
          <ul className="legend">{data.map((d) => <li key={d.name}><i style={{ background: d.c }} />{d.name}<b>{d.value}</b></li>)}</ul>
        </div>
      </Card>
      <div className="kpis">
        <Kpi label="Runs observed" value={live.total_runs} sub="all time" onClick={() => onNavigate("/traces")} />
        <Kpi label="Flagged runs" value={live.runs_with_findings} sub={pct(live.failure_rate, 0) + " of runs"} tone={BAD} onClick={() => onNavigate("/traces", { status: "flagged" })} />
        <Kpi label="Urgent problems" value={urgent} sub={severities.filter((s) => ["critical", "high"].includes(s)).join(" + ")} tone={sevColor("critical")} hint="Runs whose worst finding is critical or high." onClick={() => onNavigate("/traces", { sort: "severity", status: "flagged" })} />
        <Kpi label="Healthy runs" value={live.clean_runs} sub="no findings" tone={GOOD} onClick={() => onNavigate("/traces", { status: "clean" })} />
      </div>
    </div>
  );
}
