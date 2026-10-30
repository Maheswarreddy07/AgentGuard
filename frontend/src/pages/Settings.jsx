import { useEffect, useMemo, useState } from "react";
import { api, roleLabel, useApi, useAuth, useMeta } from "../api";
import { Card, CopyButton, Empty, State, Tabs, Toggle, timeAgo, useToast, when } from "../ui";

const Status = ({ tone, title, children }) => <div className="statcard"><span className={"dot " + tone} /><div><b>{title}</b><div className="muted small">{children}</div></div></div>;

function Overview({ s, health }) {
  const meta = useMeta(), { user } = useAuth(), sys = s.system;
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Is everything working?">
          <Status tone={health?.status === "ok" ? "up" : "down"} title="Backend">{health?.status === "ok" ? `Running (version ${health.version})` : "Not reachable"}</Status>
          <Status tone={health?.database === "ok" ? "up" : "down"} title="Database">{health?.database === "ok" ? "Connected — your data is being saved" : "Not reachable"}</Status>
          <Status tone={sys.ai.enabled ? "up" : "warn"} title="AI second opinion">{sys.ai.enabled ? `On (${sys.ai.provider})` : "Off. This is optional — every finding comes from rules and works without it."}</Status>
          <Status tone={sys.auth_required ? "up" : "warn"} title="Sign-in">{sys.auth_required ? `Required. Sessions last ${sys.session_hours} hours.` : "Turned off — anyone who can reach this server has full access. Only use this on your own machine."}</Status>
        </Card>
        <Card title="Who can do what" sub={`You are signed in as ${roleLabel(meta, user.role)}`}>
          <ul className="roles">{meta.roles.map((r) => <li key={r.key} className={r.key === user.role ? "me" : ""}><b>{r.label}</b><span className="muted">{r.plain}</span></li>)}</ul>
          <p className="muted small">Software agents don’t sign in: they use an API key, which can only send traces (see “Connect an agent”).</p>
        </Card>
      </div>
      <Card title="How your data is protected" sub="Applied automatically before anything is stored">
        <ul className="plain">{sys.redaction.map((r) => <li key={r}>Hidden or removed: {r}</li>)}<li>Largest batch of events accepted in one request: {sys.max_events_per_request}</li></ul>
      </Card>
    </div>
  );
}

function Safety({ s, reload }) {
  const { user, can } = useAuth(), meta = useMeta(), toast = useToast(), admin = can("admin");
  const base = useMemo(() => ({ values: Object.fromEntries(s.fields.map((f) => [f.key, f.value])), off: s.rules.filter((r) => !r.enabled).map((r) => r.key).sort() }), [s]);
  const [vals, setVals] = useState(base.values), [off, setOff] = useState(base.off), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => { setVals(base.values); setOff(base.off); }, [base]);
  const dirty = s.fields.some((f) => vals[f.key] !== base.values[f.key]) || JSON.stringify([...off].sort()) !== JSON.stringify(base.off);
  async function save() {
    setBusy(true);
    try {
      const values = Object.fromEntries(s.fields.filter((f) => vals[f.key] !== base.values[f.key]).map((f) => [f.key, vals[f.key] === f.default ? null : vals[f.key]]));
      const r = await api("/api/v1/settings", { method: "PUT", body: JSON.stringify({ values, disabled_rules: off }) });
      toast(r.changes.length ? "Saved. " + r.changes.join(" · ") : "Nothing needed changing."); reload();
    } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); }
  }
  async function cleanup() { try { const r = await api("/api/v1/settings/cleanup", { method: "POST" }); toast(`Cleaned up: ${r.deleted_traces} old trace(s) deleted.`); } catch (e) { toast(e.message, "bad"); } setConfirm(false); }
  const groups = [...new Set(s.fields.map((f) => f.group))];
  return (
    <div className="stack">
      {!admin && <div className="callout">You can see these settings, but only admins can change them. You are a {roleLabel(meta, user.role)}.</div>}
      {groups.map((g) => { const fs = s.fields.filter((f) => f.group === g); return (
        <Card key={g} title={fs[0].group_label}>
          {fs.map((f) => (
            <div className="setting" key={f.key}>
              <div className="setting-t"><b>{f.label}</b>{(vals[f.key] !== f.default) && <span className="badge">changed from default ({f.default})</span>}</div>
              <p className="muted">{f.help}</p>
              <div className="setting-c">
                <input type="range" aria-label={f.label} min={f.min} max={Math.min(f.max, 100)} value={Math.min(vals[f.key], Math.min(f.max, 100))} disabled={!admin} onChange={(e) => setVals({ ...vals, [f.key]: +e.target.value })} />
                <input type="number" aria-label={`${f.label} (number)`} min={f.min} max={f.max} value={vals[f.key]} disabled={!admin} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value === "" ? f.min : +e.target.value })} /><span className="muted">{f.unit}</span>
                {admin && vals[f.key] !== f.default && <button className="linkbtn" onClick={() => setVals({ ...vals, [f.key]: f.default })}>Reset to default</button>}
              </div>
              {f.key === "retention_days" && admin && (confirm ? <div className="row"><span>Delete all traces older than {base.values.retention_days} days?</span><button className="btn" onClick={cleanup}>Yes, delete</button><button className="linkbtn" onClick={() => setConfirm(false)}>Cancel</button></div>
                : <button className="btn" disabled={!base.values.retention_days} title={base.values.retention_days ? "" : "Set a number of days first and save"} onClick={() => setConfirm(true)}>Clean up now</button>)}
            </div>))}
        </Card>); })}
      <Card title="Detection rules" sub="Turn off a rule to stop AgentGuard looking for that problem. Everything stored is re-checked when you save." hint="Turning a rule off also lowers recall in the Benchmark Lab, so you can see what you give up.">
        <ul className="rules">{s.rules.map((r) => (
          <li key={r.key}><Toggle checked={!off.includes(r.key)} disabled={!admin} label={r.label} onChange={(on) => setOff(on ? off.filter((x) => x !== r.key) : [...off, r.key])} />
            <div><b>{r.label}</b><div className="muted">{r.description}</div><div className="muted small">Needs: {r.needs}</div></div></li>))}</ul>
      </Card>
      {dirty && admin && <div className="savebar" role="region" aria-label="Unsaved changes"><span>You have unsaved changes.</span><button className="btn" onClick={() => { setVals(base.values); setOff(base.off); }}>Discard</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button></div>}
    </div>
  );
}

function Connect({ s }) {
  const { can } = useAuth(), toast = useToast(), admin = can("admin");
  const keys = useApi(admin ? "/api/v1/api-keys" : null);
  const [name, setName] = useState(""), [fresh, setFresh] = useState(null);
  const c = s.system.connect, snippet = fresh ? c.snippet.replace("YOUR_API_KEY", fresh.key) : c.snippet;
  async function create() { try { setFresh(await api("/api/v1/api-keys", { method: "POST", body: JSON.stringify({ name }) })); setName(""); keys.reload(); } catch (e) { toast(e.message, "bad"); } }
  async function revoke(k) { try { await api(`/api/v1/api-keys/${k.id}`, { method: "DELETE" }); toast(`Revoked “${k.name}”.`); keys.reload(); } catch (e) { toast(e.message, "bad"); } }
  return (
    <div className="stack">
      <Card title="Step 1 — Create an API key" sub="Your agent uses this key to send runs to AgentGuard. A key can only send data; it can’t read anything.">
        {!admin ? <p className="muted">Ask an admin to create a key for you.</p> : (<>
          <div className="row"><label className="field grow">Key name (e.g. the agent it is for)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-agent (production)" /></label><button className="btn primary" disabled={!name.trim()} onClick={create}>Create key</button></div>
          {fresh && <div className="keybox" role="status"><b>Your new key — copy it now, it won’t be shown again:</b><code>{fresh.key}</code><CopyButton text={fresh.key} /></div>}
          {keys.data && (keys.data.items.length === 0 ? <p className="muted">No keys yet.</p> : <div className="scroll"><table className="tbl"><thead><tr><th>Name</th><th>Starts with</th><th>Created</th><th>Last used</th><th /></tr></thead><tbody>{keys.data.items.map((k) => (
            <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}…</td><td title={when(k.created_at)}>{timeAgo(k.created_at)} by {k.created_by}</td><td>{k.last_used_at ? timeAgo(k.last_used_at) : "never"}</td><td>{k.revoked_at ? <span className="badge">revoked</span> : <button className="btn" onClick={() => revoke(k)}>Revoke</button>}</td></tr>))}</tbody></table></div>)}
        </>)}
      </Card>
      <Card title="Step 2 — Install the SDK" right={<CopyButton text={c.install} />}><pre>{c.install}</pre></Card>
      <Card title="Step 3 — Add this to your agent" right={<CopyButton text={snippet} />} sub={fresh ? "Your new key is already filled in." : "Replace YOUR_API_KEY with the key from step 1."}>
        <pre>{snippet}</pre><p className="muted small">AgentGuard can only find problems you describe: declare an argument schema, required tools, and which actions are consequential. Its address here is <code>{c.base_url}</code>.</p>
      </Card>
    </div>
  );
}

function Team() {
  const meta = useMeta(), { user } = useAuth(), toast = useToast(), users = useApi("/api/v1/users");
  const [f, setF] = useState({ email: "", name: "", role: "viewer", password: "" }), [reset, setReset] = useState({});
  const call = async (fn, ok) => { try { await fn(); if (ok) toast(ok); users.reload(); } catch (e) { toast(e.message, "bad"); } };
  return (
    <div className="stack">
      <Card title="People" sub="Everyone who can sign in to this AgentGuard">
        <State loading={users.loading && !users.data} error={users.error} h={120} />
        {users.data && <div className="scroll"><table className="tbl"><thead><tr><th>Person</th><th>Role</th><th>Active</th><th>Last sign-in</th><th>Password</th></tr></thead><tbody>{users.data.items.map((u) => (
          <tr key={u.id}><td><b>{u.name}</b> {u.email === user.email && <span className="badge">you</span>}<div className="muted small">{u.email}</div></td>
            <td><select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => call(() => api(`/api/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }), "Role updated.")}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></td>
            <td><Toggle checked={u.is_active} label={`Active: ${u.email}`} onChange={(v) => call(() => api(`/api/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ is_active: v }) }), v ? "Re-enabled." : "Disabled and signed out.")} /></td>
            <td>{u.last_login_at ? timeAgo(u.last_login_at) : "never"}</td>
            <td>{reset[u.id] === undefined ? <button className="btn" onClick={() => setReset({ ...reset, [u.id]: "" })}>Reset…</button> : <span className="row"><input type="password" aria-label={`New password for ${u.email}`} placeholder="new password" value={reset[u.id]} onChange={(e) => setReset({ ...reset, [u.id]: e.target.value })} /><button className="btn" onClick={() => call(() => api(`/api/v1/users/${u.id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: reset[u.id] }) }).then(() => setReset({ ...reset, [u.id]: undefined })), "Password reset; they were signed out.")}>Set</button></span>}</td></tr>))}</tbody></table></div>}
        <p className="muted small">There must always be at least one active admin; AgentGuard won’t let you remove the last one.</p>
      </Card>
      <Card title="Add a person" sub="Share the password with them securely; they can change it after signing in.">
        <form className="filters" onSubmit={(e) => { e.preventDefault(); call(() => api("/api/v1/users", { method: "POST", body: JSON.stringify(f) }).then(() => setF({ email: "", name: "", role: "viewer", password: "" })), "Person added."); }}>
          <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field grow">Email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          <label className="field">Starting password<input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn primary">Add</button></form>
        <p className="muted small">{meta.roles.find((r) => r.key === f.role)?.plain}</p>
      </Card>
    </div>
  );
}

function Account() {
  const { user, authRequired } = useAuth(), meta = useMeta(), toast = useToast();
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" }), [busy, setBusy] = useState(false);
  async function change(e) {
    e.preventDefault();
    if (f.new_password !== f.confirm) return toast("The new passwords don’t match.", "bad");
    setBusy(true);
    try { await api("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: f.current_password, new_password: f.new_password }) }); toast("Password changed. Other devices were signed out."); setF({ current_password: "", new_password: "", confirm: "" }); }
    catch (e2) { toast(e2.message, "bad"); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <Card title="Your account"><ul className="plain"><li>Name: <b>{user.name}</b></li><li>Email: <b>{user.email}</b></li><li>Role: <b>{roleLabel(meta, user.role)}</b> — {meta.roles.find((r) => r.key === user.role)?.plain}</li></ul></Card>
      {authRequired ? (
        <Card title="Change your password" sub="Changing it signs you out everywhere else."><form className="stack narrow" onSubmit={change}>
          <label className="field">Current password<input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" /></label>
          <label className="field">New password<input type="password" required value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" /></label>
          <label className="field">Repeat new password<input type="password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button></form></Card>
      ) : <Empty title="Sign-in is turned off" icon="🔓"><p className="muted">There are no passwords to manage in local mode.</p></Empty>}
    </div>
  );
}

export default function Settings({ params = {} }) {
  const { can } = useAuth(), s = useApi("/api/v1/settings"), h = useApi("/health");
  const [tab, setTab] = useState(params.tab ?? "overview");
  const tabs = [{ key: "overview", label: "Overview" }, { key: "safety", label: "Safety & detection" }, { key: "connect", label: "Connect an agent" }, ...(can("admin") ? [{ key: "team", label: "Team" }] : []), { key: "account", label: "My account" }];
  return (
    <div className="stack">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {!s.data ? <State loading={s.loading} error={s.error} h={240} /> : (<>
        {tab === "overview" && <Overview s={s.data} health={h.data} />}
        {tab === "safety" && <Safety s={s.data} reload={s.reload} />}
        {tab === "connect" && <Connect s={s.data} />}
        {tab === "team" && can("admin") && <Team />}
        {tab === "account" && <Account />}
      </>)}
    </div>
  );
}
