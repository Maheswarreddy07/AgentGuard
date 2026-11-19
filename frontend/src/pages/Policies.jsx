import { useEffect, useState } from "react";
import { paths, policyApi, useApi, useAuth, useMeta } from "../api";
import SafetyRuleCard from "../components/SafetyRuleCard";
import { Caption, Card, Chip, Drawer, Empty, State, Tabs, timeAgo, useToast, when } from "../ui";
import AgentPicker from "../components/AgentPicker";
import { useT } from "../hooks/context";

const toList = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const parseVal = (s) => { try { return JSON.parse(s); } catch { return s; } };
export function describe(spec, c) {
  if (!spec) return c.type;
  const parts = spec.fields.map((f) => [f.label, c[f.name]]).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)).map(([l, v]) => `${l}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`);
  return spec.label + (parts.length ? " — " + parts.join(" · ") : "");
}
function toDef(f, specs) {
  const cond = { type: f.type };
  for (const fld of specs[f.type].fields) { const v = f.cond[fld.name]; if (v == null || v === "") continue; cond[fld.name] = fld.kind === "list" ? toList(v) : fld.kind === "number" ? Number(v) : fld.kind === "value" ? parseVal(v) : v; }
  return { scope: { agents: toList(f.agents).length ? toList(f.agents) : ["*"], tools: toList(f.tools).length ? toList(f.tools) : ["*"] }, condition: cond, action: f.action, severity: f.severity, message: f.message };
}
function fromDef(d) {
  const cond = {}; Object.entries(d.condition).forEach(([k, v]) => { if (k !== "type") cond[k] = Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : v; });
  return { type: d.condition.type, cond, agents: d.scope.agents.join(", "), tools: d.scope.tools.join(", "), action: d.action, severity: d.severity, message: d.message ?? "" };
}

function Form({ policy, templates, onClose, onSaved }) {
  const known = (useApi(paths.agents).data?.items ?? []).map((a) => a.name);
  const txt = useT("policies");
  const meta = useMeta(), toast = useToast(), { allowed } = useAuth(), specs = templates.condition_specs;
  const blank = { type: templates.condition_types[0], cond: {}, agents: "*", tools: "*", action: "BLOCK", severity: "high", message: "" };
  const [meta0, setMeta0] = useState({ name: policy?.name ?? "", description: policy?.description ?? "", category: policy?.category ?? "custom", note: "" });
  const [f, setF] = useState(policy ? fromDef(policy.definition) : blank), [test, setTest] = useState({ tool: "", args: "{}", consequential: false }), [res, setRes] = useState(null), [busy, setBusy] = useState(false);
  const spec = specs[f.type], def = () => toDef(f, specs);
  const fromTemplate = (t) => { setMeta0({ ...meta0, name: t.name, description: t.description, category: t.category }); setF(fromDef(t.definition)); };
  async function run(kind, call) { setBusy(true); setRes(null); try { setRes({ kind, data: await call() }); } catch (e) { setRes({ error: e.message }); } finally { setBusy(false); } }
  async function save() {
    setBusy(true);
    try {
      if (policy) await policyApi.update(policy.id, { description: meta0.description, category: meta0.category, definition: def(), note: meta0.note });
      else await policyApi.create({ ...meta0, definition: def() });
      toast(txt("policy_saved")); onSaved();
    } catch (e) { setRes({ error: e.message }); } finally { setBusy(false); }
  }
  return (
    <Drawer title={policy ? txt("edit_name", { name: policy.name }) : txt("new_policy")} onClose={onClose}>
      {!policy && <><h4 className="sec">{txt("start_from_a_template")}</h4><div className="chips">{templates.items.map((t) => <Chip key={t.name} onClick={() => fromTemplate(t)}>{t.name.replace(/_/g, " ")}</Chip>)}</div></>}
      <h4 className="sec">{txt("1_what_is_it_called")}</h4>
      <label className="field">{txt("name")}<input value={meta0.name} disabled={!!policy} onChange={(e) => setMeta0({ ...meta0, name: e.target.value })} placeholder={txt("prevent_duplicate_refunds")} /></label>
      <label className="field">{txt("what_is_it_for")}<input value={meta0.description} onChange={(e) => setMeta0({ ...meta0, description: e.target.value })} /></label>
      <label className="field">{txt("kind")}<select value={meta0.category} onChange={(e) => setMeta0({ ...meta0, category: e.target.value })}>{templates.categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></label>
      <h4 className="sec">{txt("2_which_calls_does_it")}</h4>
      <div className="row"><div className="grow"><AgentPicker value={f.agents} known={known} onChange={(v) => setF({ ...f, agents: v })} /></div><label className="field grow">{txt("tools_comma_separated_all")}<input value={f.tools} onChange={(e) => setF({ ...f, tools: e.target.value })} /></label></div>
      <h4 className="sec">{txt("3_when_should_it_trigger")}</h4>
      <label className="field">{txt("condition")}<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, cond: {} })}>{templates.condition_types.map((t) => <option key={t} value={t}>{specs[t].label}</option>)}</select></label>
      <p className="muted small">{spec.help}</p>
      {spec.fields.map((fld) => <label className="field" key={fld.name}>{fld.label}{fld.kind === "select" ? <select value={f.cond[fld.name] ?? ""} onChange={(e) => setF({ ...f, cond: { ...f.cond, [fld.name]: e.target.value } })}><option value="">{txt("choose")}</option>{fld.options.map((o) => <option key={o}>{o}</option>)}</select>
        : <input value={f.cond[fld.name] ?? ""} type={fld.kind === "number" ? "number" : "text"} onChange={(e) => setF({ ...f, cond: { ...f.cond, [fld.name]: e.target.value } })} />}{fld.help && <span className="muted small">{fld.help}</span>}</label>)}
      <h4 className="sec">{txt("4_what_should_happen")}</h4>
      <div className="row"><label className="field grow">{txt("action")}<select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{Object.entries(meta.policy_actions).map(([k, l]) => <option key={k} value={k}>{k.replace(/_/g, " ")} — {l}</option>)}</select></label>
        <label className="field">{txt("severity")}<select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{meta.severities.map((s) => <option key={s}>{s}</option>)}</select></label></div>
      <label className="field">{txt("message_shown_with_the_decision")}<input value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder={txt("large_refund")} /></label>
      <h4 className="sec">{txt("try_it_before_saving")}</h4>
      <div className="row"><label className="field grow">{txt("tool_being_called")}<input value={test.tool} onChange={(e) => setTest({ ...test, tool: e.target.value })} placeholder={txt("issue_refund")} /></label><label className="field grow">{txt("its_arguments_json")}<input value={test.args} onChange={(e) => setTest({ ...test, args: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={test.consequential} onChange={(e) => setTest({ ...test, consequential: e.target.checked })} />{txt("consequential")}</label></div>
      <div className="row"><button className="btn" disabled={busy || !test.tool} onClick={() => run("test", () => policyApi.test(def(), { tool: test.tool, args: parseVal(test.args) || {}, consequential: test.consequential }))}>{txt("test_this_call")}</button>
        <button className="btn" disabled={busy} onClick={() => run("simulate", () => policyApi.simulate(def()))}>{txt("replay_on_recent_runs")}</button></div>
      {res?.error && <div role="alert" className="alert">{res.error}</div>}
      {res?.kind === "test" && <div className="callout" role="status"><b>{res.data.in_scope ? (res.data.matched ? txt("would_trigger_v1", { v1: res.data.decision.replace(/_/g, " ") }) : txt("would_not_trigger")) : txt("not_applicable")}</b> — {res.data.explanation}</div>}
      {res?.kind === "simulate" && <div className="callout" role="status"><b>{txt("would_trigger_of_tool_calls", { would_trigger: res.data.would_trigger, tool_calls_examined: res.data.tool_calls_examined })}</b> ({Object.entries(res.data.by_action).map(([k, v]) => `${v} ${k.replace(/_/g, " ").toLowerCase()}`).join(", ") || txt("none")}). {res.data.note}
        <ul className="plain small">{res.data.samples.slice(0, 5).map((s, i) => <li key={i}><a href={"#/traces/" + s.trace_id}>{s.trace_id}</a> {txt("step_step_index_explanation", { step_index: s.step_index, explanation: s.explanation })}</li>)}</ul></div>}
      {policy && <label className="field">{txt("what_changed_kept_in_the")}<input value={meta0.note} onChange={(e) => setMeta0({ ...meta0, note: e.target.value })} /></label>}
      <div className="row"><button className="btn primary" disabled={busy || !allowed("edit_policies") || !meta0.name} onClick={save}>{policy ? txt("save_as_new_version") : txt("create_policy")}</button>{!allowed("edit_policies") && <span className="muted small">{txt("only_admins_can_save_policies")}</span>}</div>
    </Drawer>
  );
}

function Versions({ policy, onClose, onChanged }) {
  const txt = useT("policies");
  const { allowed } = useAuth(), toast = useToast(), d = useApi(paths.policy(policy.id));
  async function rollback(v) { try { await policyApi.rollback(policy.id, v); toast(txt("rolled_back_vv_is_now", { v })); d.reload(); onChanged(); } catch (e) { toast(e.message, "bad"); } }
  return (
    <Drawer title={txt("name_history", { name: policy.name })} onClose={onClose}>
      <State loading={d.loading && !d.data} error={d.error} h={120} />
      {d.data?.versions.map((v) => <div key={v.version} className="finding" style={{ "--c": v.version === d.data.version ? "var(--good)" : "var(--line)" }}><div className="row"><b>{txt("version_version", { version: v.version })}</b>{v.version === d.data.version && <span className="badge">{txt("in_use")}</span>}<span className="muted small">{v.created_by} · {when(v.created_at)}</span></div>
        <p className="muted">{v.note}</p><pre>{JSON.stringify(v.definition, null, 1)}</pre>{v.version !== d.data.version && allowed("edit_policies") && <button className="btn" onClick={() => rollback(v.version)}>{txt("roll_back_to_this_version")}</button>}</div>)}
      <Caption>{txt("history_is_never_rewritten_a")}</Caption>
    </Drawer>
  );
}

function Log() {
  const txt = useT("policies");
  const [only, setOnly] = useState(true), l = useApi(paths.policyEvaluations({ limit: 50, matched_only: only ? "true" : "" }));
  return (
    <Card title={txt("every_decision_with_the_reason")} sub={txt("stored_with_the_exact_inputs")}>
      <div className="chips"><Chip active={only} onClick={() => setOnly(true)}>{txt("only_rules_that_triggered")}</Chip><Chip active={!only} onClick={() => setOnly(false)}>{txt("everything_evaluated")}</Chip></div>
      <State loading={l.loading && !l.data} error={l.error} h={120} />
      {l.data && (l.data.items.length === 0 ? <p className="muted">{txt("no_decisions_yet")}</p> : <div className="scroll"><table className="tbl"><thead><tr><th>{txt("when")}</th><th>{txt("policy")}</th><th>{txt("tool")}</th><th>{txt("result")}</th><th>{txt("why")}</th><th>{txt("run")}</th></tr></thead><tbody>
        {l.data.items.map((e) => <tr key={e.id}><td title={when(e.created_at)}>{timeAgo(e.created_at)}</td><td>{e.policy_name} <span className="muted small">{txt("vversion", { version: e.version })}</span></td><td className="mono">{e.tool_name}</td>
          <td><span className="badge sev" style={{ "--c": e.matched ? (e.effective === "ALLOW" ? "var(--good)" : "var(--bad)") : "var(--mut)" }}>{e.matched ? e.effective.replace(/_/g, " ") : txt("no_match")}</span>{e.matched && e.mode !== "enforce" && <span className="muted small"> {txt("mode_mode", { mode: e.mode })}</span>}</td><td className="small">{e.explanation}</td><td><a href={"#/traces/" + e.trace_id} className="mono">{e.trace_id}</a></td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

export default function Policies() {
  const txt = useT("policies");
  const meta = useMeta(), { allowed } = useAuth(), toast = useToast(), pol = useApi(paths.policies), tpl = useApi(paths.policyTemplates);
  const [tab, setTab] = useState("policies"), [edit, setEdit] = useState(null), [hist, setHist] = useState(null);
  async function toggle(p, enabled) { try { await policyApi.toggle(p.id, enabled); pol.reload(); toast(txt("name_is_now_v2", { name: p.name, v2: enabled ? "on" : "off" })); } catch (e) { toast(e.message, "bad"); } }
  const specs = tpl.data?.condition_specs;
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "policies", label: txt("tab_policies"), badge: pol.data?.items.length }, { key: "log", label: txt("tab_log") }]} />
      {tab === "log" ? <Log /> : (<>
        <Card title={txt("rules_for_what_agents_may")} sub={txt("checked_before_every_tool_call")} right={<button className="btn primary" disabled={!allowed("edit_policies") || !tpl.data} onClick={() => setEdit({})}>{txt("new_policy_2")}</button>}>
          <div className="modes">{Object.entries(meta.modes).map(([k, v]) => <div key={k}><b>{k}</b><span className="muted">{v}</span></div>)}</div>
        </Card>
        <State loading={pol.loading && !pol.data} error={pol.error} h={160} />
        {pol.data && pol.data.items.length === 0 && <Empty title={txt("no_policies_yet")} icon="🛡"><p className="muted">{txt("without_policies_agentguard_still_records")}</p>{allowed("edit_policies") && tpl.data && <button className="btn primary" onClick={() => setEdit({})}>{txt("create_the_first_policy")}</button>}</Empty>}
        {pol.data?.items.map((p) => <SafetyRuleCard key={p.id} rule={p} canEdit={allowed("edit_policies")} conditionText={specs ? describe(specs[p.definition.condition.type], p.definition.condition) : p.definition.condition.type} onToggle={toggle} onEdit={setEdit} onHistory={setHist} onDelete={async (r) => { await policyApi.remove(r.id); pol.reload(); }} />)}
      </>)}
      {edit && tpl.data && <Form policy={edit.id ? edit : null} templates={tpl.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); pol.reload(); }} />}
      {hist && <Versions policy={hist} onClose={() => setHist(null)} onChanged={pol.reload} />}
    </div>
  );
}
