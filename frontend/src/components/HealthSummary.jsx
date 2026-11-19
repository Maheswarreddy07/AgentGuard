import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { BAD, Card, GOOD, Kpi, chartTip, pct, sevColor } from "../ui";
import { useT } from "../hooks/context";

/** Overall health: a donut of healthy vs flagged runs, and the four numbers people look at first. */
export default function HealthSummary({ live, severities = [], onNavigate }) {
  const txt = useT("health_summary");
  const data = [{ name: txt("legend_healthy"), value: live.clean_runs, c: GOOD }, { name: txt("legend_flagged"), value: live.runs_with_findings, c: BAD }];
  const urgent = ["critical", "high"].reduce((n, s) => n + (live.by_severity[s] ?? 0), 0);
  return (
    <div className="grid-2">
      <Card title={txt("agent_health")} sub={txt("share_of_runs_where_no")} hint={txt("a_run_is_flagged_when")}>
        <div className="health">
          <div className="donut">
            <ResponsiveContainer width="100%" height={170}><PieChart><Pie data={data} dataKey="value" innerRadius={55} outerRadius={78} stroke="none" paddingAngle={2}>{data.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip {...chartTip} /></PieChart></ResponsiveContainer>
            <div className="donut-c"><b>{pct(1 - (live.failure_rate ?? 0), 0)}</b><span>{txt("healthy")}</span></div>
          </div>
          <ul className="legend">{data.map((d) => <li key={d.name}><i style={{ background: d.c }} />{d.name}<b>{d.value}</b></li>)}</ul>
        </div>
      </Card>
      <div className="kpis">
        <Kpi label={txt("runs_observed")} value={live.total_runs} sub={txt("all_time")} onClick={() => onNavigate("/traces")} />
        <Kpi label={txt("flagged_runs")} value={live.runs_with_findings} sub={pct(live.failure_rate, 0) + " of runs"} tone={BAD} onClick={() => onNavigate("/traces", { status: "flagged" })} />
        <Kpi label={txt("urgent_problems")} value={urgent} sub={severities.filter((s) => ["critical", "high"].includes(s)).join(" + ")} tone={sevColor("critical")} hint={txt("runs_whose_worst_finding_is")} onClick={() => onNavigate("/traces", { sort: "severity", status: "flagged" })} />
        <Kpi label={txt("healthy_runs")} value={live.clean_runs} sub={txt("no_findings")} tone={GOOD} onClick={() => onNavigate("/traces", { status: "clean" })} />
      </div>
    </div>
  );
}
