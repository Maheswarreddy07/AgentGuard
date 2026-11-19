import { useState } from "react";
import { useText } from "../hooks/context";

/** Choose which agents a safety rule applies to. `value` is the comma-separated list the rule stores ("*" = every agent). */
export default function AgentPicker({ value, known, onChange }) {
  const t = useText("safety"), list = value.split(",").map((s) => s.trim()).filter(Boolean), all = list.length === 0 || list.includes("*"), [extra, setExtra] = useState("");
  const names = [...new Set([...known, ...list.filter((x) => x !== "*")])], set = (arr) => onChange(arr.length ? arr.join(", ") : "*");
  return (
    <fieldset className="picker"><legend className="muted small">{t.scope_help}</legend>
      <label className="choice"><input type="radio" name="agent-scope" checked={all} onChange={() => onChange("*")} /><span>{t.all_agents}</span></label>
      <label className="choice"><input type="radio" name="agent-scope" checked={!all} onChange={() => set(names.slice(0, 1))} disabled={names.length === 0} /><span>{t.only_these}</span></label>
      {names.length === 0 && <p className="muted small">{t.none_registered}</p>}
      {!all && <div className="picker-list">{names.map((n) => <label key={n} className="chip-check"><input type="checkbox" checked={list.includes(n)} onChange={(e) => set(e.target.checked ? [...list, n] : list.filter((x) => x !== n))} />{n}</label>)}
        <span className="row"><input aria-label={t.extra_label} placeholder={t.extra_placeholder} value={extra} onChange={(e) => setExtra(e.target.value)} /><button type="button" className="btn sm" disabled={!extra.trim()} onClick={() => { set([...list, extra.trim()]); setExtra(""); }}>{t.add}</button></span></div>}
    </fieldset>
  );
}
