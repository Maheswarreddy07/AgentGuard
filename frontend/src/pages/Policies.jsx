import { useEffect, useState } from "react";
import { api, useApi, useAuth, useMeta } from "../api";
import { Caption, Card, Chip, Drawer, Empty, State, Tabs, Toggle, sevColor, timeAgo, useToast, when } from "../ui";

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
  const meta = useMeta(), toast = useToast(), { can } = useAuth(), specs = templates.condition_specs;
  const blank = { type: templates.condition_types[0], cond: {}, agents: "*", tools: "*", action: "BLOCK", severity: "high", message: "" };
  const [meta0, setMeta0] = useState({ name: policy?.name ?? "", description: policy?.description ?? "", category: policy?.category ?? "custom", note: "" });
  const [f, setF] = useState(policy ? fromDef(policy.definition) : blank), [test, setTest] = useState({ tool: "", args: "{}", consequential: false }), [res, setRes] = useState(null), [busy, setBusy] = useState(false);
  const spec = specs[f.type], def = () => toDef(f, specs);
  const fromTemplate = (t) => { setMeta0({ ...meta0, name: t.name, description: t.description, category: t.category }); setF(fromDef(t.definition)); };
  async function run(path, body) { setBusy(true); setRes(null); try { setRes({ kind: path, data: await api(path, { method: "POST", body: JSON.stringify(body) }) }); } catch (e) { setRes({ error: e.message }); } finally { setBusy(false); } }
  async function save() {
    setBusy(true);
    try {
      if (policy) await api(`/api/v1/policies/${policy.id}`, { method: "PUT", body: JSON.stringify({ description: meta0.description, category: meta0.category, definition: def(), note: meta0.note }) });
      else await api("/api/v1/policies", { method: "POST", body: JSON.stringify({ ...meta0, definition: def() }) });
      toast("Policy saved."); onSaved();
    } catch (e) { setRes({ error: e.message }); } finally { setBusy(false); }
  }
  return (
    <Drawer title={policy ? `Edit ${policy.name}` : "New policy"} onClose={onClose}>
      {!policy && <><h4 className="sec">Start from a template</h4><div className="chips">{templates.items.map((t) => <Chip key={t.name} onClick={() => fromTemplate(t)}>{t.name.replace(/_/g, " ")}</Chip>)}</div></>}
      <h4 className="sec">1 · What is it called?</h4>
      <label className="field">Name<input value={meta0.name} disabled={!!policy} onChange={(e) => setMeta0({ ...meta0, name: e.target.value })} placeholder="prevent_duplicate_refunds" /></label>
      <label className="field">What is it for?<input value={meta0.description} onChange={(e) => setMeta0({ ...meta0, description: e.target.value })} /></label>
      <label className="field">Kind<select value={meta0.category} onChange={(e) => setMeta0({ ...meta0, category: e.target.value })}>{templates.categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></label>
      <h4 className="sec">2 · Which calls does it cover?</h4>
      <div className="row"><label className="field grow">Agents (comma-separated, * = all)<input value={f.agents} onChange={(e) => setF({ ...f, agents: e.target.value })} /></label><label className="field grow">Tools (comma-separated, * = all)<input value={f.tools} onChange={(e) => setF({ ...f, tools: e.target.value })} /></label></div>
      <h4 className="sec">3 · When should it trigger?</h4>
      <label className="field">Condition<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, cond: {} })}>{templates.condition_types.map((t) => <option key={t} value={t}>{specs[t].label}</option>)}</select></label>
      <p className="muted small">{spec.help}</p>
      {spec.fields.map((fld) => <label className="field" key={fld.name}>{fld.label}{fld.kind === "select" ? <select value={f.cond[fld.name] ?? ""} onChange={(e) => setF({ ...f, cond: { ...f.cond, [fld.name]: e.target.value } })}><option value="">Choose…</option>{fld.options.map((o) => <option key={o}>{o}</option>)}</select>
        : <input value={f.cond[fld.name] ?? ""} type={fld.kind === "number" ? "number" : "text"} onChange={(e) => setF({ ...f, cond: { ...f.cond, [fld.name]: e.target.value } })} />}{fld.help && <span className="muted small">{fld.help}</span>}</label>)}
      <h4 className="sec">4 · What should happen?</h4>
      <div className="row"><label className="field grow">Action<select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{Object.entries(meta.policy_actions).map(([k, l]) => <option key={k} value={k}>{k.replace(/_/g, " ")} — {l}</option>)}</select></label>
        <label className="field">Severity<select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{meta.severities.map((s) => <option key={s}>{s}</option>)}</select></label></div>
      <label className="field">Message shown with the decision<input value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Large refund" /></label>
      <h4 className="sec">Try it before saving</h4>
      <div className="row"><label className="field grow">Tool being called<input value={test.tool} onChange={(e) => setTest({ ...test, tool: e.target.value })} placeholder="issue_refund" /></label><label className="field grow">Its arguments (JSON)<input value={test.args} onChange={(e) => setTest({ ...test, args: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={test.consequential} onChange={(e) => setTest({ ...test, consequential: e.target.checked })} />consequential</label></div>
      <div className="row"><button className="btn" disabled={busy || !test.tool} onClick={() => run("/api/v1/policies/test", { definition: def(), context: { tool: test.tool, args: parseVal(test.args) || {}, consequential: test.consequential } })}>Test this call</button>
        <button className="btn" disabled={busy} onClick={() => run("/api/v1/policies/simulate", { definition: def() })}>Replay on recent runs</button></div>
      {res?.error && <div role="alert" className="alert">{res.error}</div>}
      {res?.kind?.endsWith("/test") && <div className="callout" role="status"><b>{res.data.in_scope ? (res.data.matched ? `Would trigger: ${res.data.decision.replace(/_/g, " ")}` : "Would not trigger") : "Not applicable"}</b> — {res.data.explanation}</div>}
      {res?.kind?.endsWith("/simulate") && <div className="callout" role="status"><b>{res.data.would_trigger} of {res.data.tool_calls_examined} recent tool calls would have been affected</b> ({Object.entries(res.data.by_action).map(([k, v]) => `${v} ${k.replace(/_/g, " ").toLowerCase()}`).join(", ") || "none"}). {res.data.note}
        <ul className="plain small">{res.data.samples.slice(0, 5).map((s, i) => <li key={i}><a href={"#/traces/" + s.trace_id}>{s.trace_id}</a> step {s.step_index}: {s.explanation}</li>)}</ul></div>}
      {policy && <label className="field">What changed? (kept in the version history)<input value={meta0.note} onChange={(e) => setMeta0({ ...meta0, note: e.target.value })} /></label>}
      <div className="row"><button className="btn primary" disabled={busy || !can("admin") || !meta0.name} onClick={save}>{policy ? "Save as new version" : "Create policy"}</button>{!can("admin") && <span className="muted small">Only admins can save policies.</span>}</div>
    </Drawer>
  );
}

function Versions({ policy, onClose, onChanged }) {
  const { can } = useAuth(), toast = useToast(), d = useApi(`/api/v1/policies/${policy.id}`);
  async function rollback(v) { try { await api(`/api/v1/policies/${policy.id}/rollback`, { method: "POST", body: JSON.stringify({ version: v }) }); toast(`Rolled back: v${v} is now the newest version.`); d.reload(); onChanged(); } catch (e) { toast(e.message, "bad"); } }
  return (
    <Drawer title={`${policy.name} — history`} onClose={onClose}>
      <State loading={d.loading && !d.data} error={d.error} h={120} />
      {d.data?.versions.map((v) => <div key={v.version} className="finding" style={{ "--c": v.version === d.data.version ? "var(--good)" : "var(--line)" }}><div className="row"><b>Version {v.version}</b>{v.version === d.data.version && <span className="badge">in use</span>}<span className="muted small">{v.created_by} · {when(v.created_at)}</span></div>
        <p className="muted">{v.note}</p><pre>{JSON.stringify(v.definition, null, 1)}</pre>{v.version !== d.data.version && can("admin") && <button className="btn" onClick={() => rollback(v.version)}>Roll back to this version</button>}</div>)}
      <Caption>History is never rewritten: a roll-back creates a new version, so you can always see what was in force when.</Caption>
    </Drawer>
  );
}

function Log() {
  const [only, setOnly] = useState(true), l = useApi(`/api/v1/policies/evaluations?limit=50${only ? "&matched_only=true" : ""}`);
  return (
    <Card title="Every decision, with the reason" sub="Stored with the exact inputs each policy saw, so any decision can be reproduced">
      <div className="chips"><Chip active={only} onClick={() => setOnly(true)}>Only rules that triggered</Chip><Chip active={!only} onClick={() => setOnly(false)}>Everything evaluated</Chip></div>
      <State loading={l.loading && !l.data} error={l.error} h={120} />
      {l.data && (l.data.items.length === 0 ? <p className="muted">No decisions yet.</p> : <div className="scroll"><table className="tbl"><thead><tr><th>When</th><th>Policy</th><th>Tool</th><th>Result</th><th>Why</th><th>Run</th></tr></thead><tbody>
        {l.data.items.map((e) => <tr key={e.id}><td title={when(e.created_at)}>{timeAgo(e.created_at)}</td><td>{e.policy_name} <span className="muted small">v{e.version}</span></td><td className="mono">{e.tool_name}</td>
          <td><span className="badge sev" style={{ "--c": e.matched ? (e.effective === "ALLOW" ? "var(--good)" : "var(--bad)") : "var(--mut)" }}>{e.matched ? e.effective.replace(/_/g, " ") : "no match"}</span>{e.matched && e.mode !== "enforce" && <span className="muted small"> ({e.mode} mode)</span>}</td><td className="small">{e.explanation}</td><td><a href={"#/traces/" + e.trace_id} className="mono">{e.trace_id}</a></td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

export default function Policies() {
  const meta = useMeta(), { can } = useAuth(), toast = useToast(), pol = useApi("/api/v1/policies"), tpl = useApi("/api/v1/policies/templates");
  const [tab, setTab] = useState("policies"), [edit, setEdit] = useState(null), [hist, setHist] = useState(null);
  async function toggle(p, enabled) { try { await api(`/api/v1/policies/${p.id}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }); pol.reload(); toast(`${p.name} is now ${enabled ? "on" : "off"}.`); } catch (e) { toast(e.message, "bad"); } }
  const specs = tpl.data?.condition_specs;
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "policies", label: "Policies", badge: pol.data?.items.length }, { key: "log", label: "Decision log" }]} />
      {tab === "log" ? <Log /> : (<>
        <Card title="Rules for what agents may do" sub="Checked before every tool call. Observe mode only records, warn mode only warns, enforce mode really stops the action." right={<button className="btn primary" disabled={!can("admin") || !tpl.data} onClick={() => setEdit({})}>＋ New policy</button>}>
          <div className="modes">{Object.entries(meta.modes).map(([k, v]) => <div key={k}><b>{k}</b><span className="muted">{v}</span></div>)}</div>
        </Card>
        <State loading={pol.loading && !pol.data} error={pol.error} h={160} />
        {pol.data && pol.data.items.length === 0 && <Empty title="No policies yet" icon="🛡"><p className="muted">Without policies AgentGuard still records and detects problems, but nothing is ever blocked. Start from a template.</p>{can("admin") && tpl.data && <button className="btn primary" onClick={() => setEdit({})}>Create the first policy</button>}</Empty>}
        {pol.data?.items.map((p) => (
          <article key={p.id} className={"policy" + (p.enabled ? "" : " off")} style={{ "--c": p.definition.action === "BLOCK" ? "var(--bad)" : p.definition.action === "REQUIRE_APPROVAL" ? "var(--warn)" : "var(--acc)" }}>
            <div className="row"><Toggle checked={p.enabled} disabled={!can("admin")} label={`Enable ${p.name}`} onChange={(v) => toggle(p, v)} /><b className="mono">{p.name}</b><span className="badge sev" style={{ "--c": "var(--c)" }}>{p.definition.action.replace(/_/g, " ")}</span>
              <span className="badge" style={{ color: sevColor(p.definition.severity) }}>{p.definition.severity}</span><span className="badge">v{p.version}</span><span className="muted small">{p.category.replace(/_/g, " ")}</span></div>
            <p>{p.description}</p>
            <p className="small"><b>Applies to:</b> {p.definition.scope.agents.join(", ")} agent(s), {p.definition.scope.tools.join(", ")} tool(s) · <b>When:</b> {specs ? describe(specs[p.definition.condition.type], p.definition.condition) : p.definition.condition.type}</p>
            <div className="row"><span className="muted small">{p.evaluations} checks · {p.matches} triggered</span><button className="linkbtn" onClick={() => setEdit(p)}>{can("admin") ? "Edit / test" : "View / test"}</button><button className="linkbtn" onClick={() => setHist(p)}>Version history ({p.n_versions})</button></div>
          </article>))}
      </>)}
      {edit && tpl.data && <Form policy={edit.id ? edit : null} templates={tpl.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); pol.reload(); }} />}
      {hist && <Versions policy={hist} onClose={() => setHist(null)} onChanged={pol.reload} />}
    </div>
  );
}
