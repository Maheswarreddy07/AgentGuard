import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BAD, Caption, GOOD, MUTED, chartTip, pct } from "../ui";

/** With vs without AgentGuard. rows = [{ label, without, with }] with values between 0 and 1. */
export default function BenchmarkComparison({ rows, height = 220, caption, layout = "columns" }) {
  const data = rows.map((r) => ({ n: r.label, base: r.without, prot: r.with }));
  const horizontal = layout === "bars";
  return (
    <div>
      <div style={{ height: horizontal ? 30 * data.length + 60 : height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 8 : 0, right: 24 }}>
            <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--line)" />
            {horizontal ? <><XAxis type="number" domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} /><YAxis type="category" dataKey="n" width={130} interval={0} stroke={MUTED} fontSize={12} /></>
              : <><XAxis dataKey="n" stroke={MUTED} fontSize={12} /><YAxis domain={[0, 1]} tickFormatter={(v) => v * 100 + "%"} stroke={MUTED} fontSize={11} width={42} /></>}
            <Tooltip {...chartTip} formatter={(v) => pct(v)} /><Legend />
            <Bar dataKey="base" name="Without AgentGuard" fill={BAD} radius={horizontal ? [0, 4, 4, 0] : [6, 6, 0, 0]}>{!horizontal && <LabelList dataKey="base" position="top" formatter={(v) => pct(v, 0)} fill="var(--fg)" fontSize={12} />}</Bar>
            <Bar dataKey="prot" name="With AgentGuard" fill={GOOD} radius={horizontal ? [0, 4, 4, 0] : [6, 6, 0, 0]}>{!horizontal && <LabelList dataKey="prot" position="top" formatter={(v) => pct(v, 0)} fill="var(--fg)" fontSize={12} />}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {caption && <Caption>{caption}</Caption>}
    </div>
  );
}
