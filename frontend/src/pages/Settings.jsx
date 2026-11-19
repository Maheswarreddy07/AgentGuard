import ConfirmDelete from "../components/ConfirmDelete";
import { useEffect, useMemo, useState } from "react";
import { authApi, paths, roleLabel, settingsApi, teamApi, useApi, useAuth, useMeta } from "../api";
import { Card, CopyButton, Empty, State, Tabs, Toggle, timeAgo, useToast, when } from "../ui";
import { useT } from "../hooks/context";

const Status = ({ tone, title, children }) => <div className="statcard"><span className={"dot " + tone} /><div><b>{title}</b><div className="muted small">{children}</div></div></div>;

function Overview({ s, health }) {
  const txt = useT("settings");
  const meta = useMeta(), { user } = useAuth(), sys = s.system;
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title={txt("is_everything_working")}>
          <Status tone={health?.status === "ok" ? "up" : "down"} title={txt("backend")}>{health?.status === "ok" ? txt("running_version_version", { version: health.version }) : txt("not_reachable")}</Status>
          <Status tone={health?.database === "ok" ? "up" : "down"} title={txt("database")}>{health?.database === "ok" ? txt("connected_your_data_is_being") : txt("not_reachable")}</Status>
          <Status tone={sys.ai.enabled ? "up" : "warn"} title={txt("ai_second_opinion")}>{sys.ai.enabled ? txt("on_provider", { provider: sys.ai.provider }) : txt("off_this_is_optional_every")}</Status>
          <Status tone={sys.auth_required ? "up" : "warn"} title={txt("sign_in")}>{sys.auth_required ? txt("required_sessions_last_session_hours", { session_hours: sys.session_hours }) : txt("turned_off_anyone_who_can")}</Status>
        </Card>
        <Card title={txt("who_can_do_what")} sub={txt("you_are_signed_in_as", { v1: roleLabel(meta, user.role) })}>
          <ul className="roles">{meta.roles.map((r) => <li key={r.key} className={r.key === user.role ? "me" : ""}><b>{r.label}</b><span className="muted">{r.plain}</span></li>)}</ul>
          <p className="muted small">{txt("software_agents_don_t_sign")}</p>
        </Card>
      </div>
      <Card title={txt("how_your_data_is_protected")} sub={txt("applied_automatically_before_anything_is")}>
        <ul className="plain">{sys.redaction.map((r) => <li key={r}>{txt("hidden_or_removed_r", { r })}</li>)}<li>{txt("largest_batch_of_events_accepted", { max_events_per_request: sys.max_events_per_request })}</li></ul>
      </Card>
    </div>
  );
}

function Provider({ s }) {
  const txt = useT("settings"), ai = s.system.ai, on = ai.enabled;
  return (
    <div className="stack">
      <Card title={txt("provider_title")}>
        <Status tone={on ? "up" : "warn"} title={txt("provider_title")}>{on ? txt("provider_on", { provider: ai.provider }) : txt("provider_off")}</Status>
        <p className="muted">{txt("provider_how")}</p><p className="muted small">{txt("provider_sends")}</p>
      </Card>
    </div>
  );
}

function Safety({ s, reload, only = "safety" }) {
  const txt = useT("settings");
  const { user, allowed } = useAuth(), meta = useMeta(), toast = useToast(), admin = allowed("change_settings");
  const base = useMemo(() => ({ values: Object.fromEntries(s.fields.map((f) => [f.key, f.value])), off: s.rules.filter((r) => !r.enabled).map((r) => r.key).sort() }), [s]);
  const [vals, setVals] = useState(base.values), [off, setOff] = useState(base.off), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => { setVals(base.values); setOff(base.off); }, [base]);
  const dirty = s.fields.some((f) => vals[f.key] !== base.values[f.key]) || JSON.stringify([...off].sort()) !== JSON.stringify(base.off);
  async function save() {
    setBusy(true);
    try {
      const values = Object.fromEntries(s.fields.filter((f) => vals[f.key] !== base.values[f.key]).map((f) => [f.key, vals[f.key] === f.default ? null : vals[f.key]]));
      const r = await settingsApi.save(values, off);
      toast(r.changes.length ? "Saved. " + r.changes.join(" · ") : txt("nothing_needed_changing")); reload();
    } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); }
  }
  async function cleanup() { try { const r = await settingsApi.cleanup(); toast(txt("cleaned_up_deleted_traces_old", { deleted_traces: r.deleted_traces })); } catch (e) { toast(e.message, "bad"); } setConfirm(false); }
  const groups = [...new Set(s.fields.map((f) => f.group))].filter((g) => (only === "retention") === (g === "data"));
  return (
    <div className="stack">
      {!admin && <div className="callout">{txt("you_can_see_these_settings")} {roleLabel(meta, user.role)}.</div>}
      {groups.map((g) => { const fs = s.fields.filter((f) => f.group === g); return (
        <Card key={g} title={fs[0].group_label}>
          {fs.map((f) => (
            <div className="setting" key={f.key}>
              <div className="setting-t"><b>{f.label}</b>{(vals[f.key] !== f.default) && <span className="badge">{txt("changed_from_default_default", { default: f.default })}</span>}</div>
              <p className="muted">{f.help}</p>
              <div className="setting-c">
                <input type="range" aria-label={f.label} min={f.min} max={Math.min(f.max, 100)} value={Math.min(vals[f.key], Math.min(f.max, 100))} disabled={!admin} onChange={(e) => setVals({ ...vals, [f.key]: +e.target.value })} />
                <input type="number" aria-label={txt("label_number", { label: f.label })} min={f.min} max={f.max} value={vals[f.key]} disabled={!admin} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value === "" ? f.min : +e.target.value })} /><span className="muted">{f.unit}</span>
                {admin && vals[f.key] !== f.default && <button className="linkbtn" onClick={() => setVals({ ...vals, [f.key]: f.default })}>{txt("reset_to_default")}</button>}
              </div>
              {f.key === "retention_days" && admin && (confirm ? <div className="row"><span>{txt("delete_all_traces_older_than", { retention_days: base.values.retention_days })}</span><button className="btn" onClick={cleanup}>{txt("yes_delete")}</button><button className="linkbtn" onClick={() => setConfirm(false)}>{txt("cancel")}</button></div>
                : <button className="btn" disabled={!base.values.retention_days} title={base.values.retention_days ? "" : txt("set_a_number_of_days")} onClick={() => setConfirm(true)}>{txt("clean_up_now")}</button>)}
            </div>))}
        </Card>); })}
      {only !== "retention" && <Card title={txt("detection_rules")} sub={txt("turn_off_a_rule_to")} hint={txt("turning_a_rule_off_also")}>
        <ul className="rules">{s.rules.map((r) => (
          <li key={r.key}><Toggle checked={!off.includes(r.key)} disabled={!admin} label={r.label} onChange={(on) => setOff(on ? off.filter((x) => x !== r.key) : [...off, r.key])} />
            <div><b>{r.label}</b><div className="muted">{r.description}</div><div className="muted small">{txt("needs_needs", { needs: r.needs })}</div></div></li>))}</ul>
      </Card>}
      {dirty && admin && <div className="savebar" role="region" aria-label={txt("unsaved_changes")}><span>{txt("you_have_unsaved_changes")}</span><button className="btn" onClick={() => { setVals(base.values); setOff(base.off); }}>{txt("discard")}</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? txt("saving") : txt("save_changes")}</button></div>}
    </div>
  );
}

function ApiKeys() {
  const txt = useT("settings");
  const { allowed } = useAuth(), toast = useToast(), admin = allowed("manage_keys"), keys = useApi(admin ? paths.apiKeys : null);
  const [name, setName] = useState(""), [fresh, setFresh] = useState(null);
  async function create() { try { setFresh(await teamApi.createKey(name)); setName(""); keys.reload(); } catch (e) { toast(e.message, "bad"); } }
  async function rotate(k) { try { setFresh(await teamApi.rotateKey(k.id)); toast(txt("rotated_name_the_old_key", { name: k.name })); keys.reload(); } catch (e) { toast(e.message, "bad"); } }
  async function revoke(k) { try { await teamApi.revokeKey(k.id); toast(txt("revoked_name", { name: k.name })); keys.reload(); } catch (e) { toast(e.message, "bad"); } }
  return (
    <div className="stack">
      <Card title={txt("api_keys")} sub={txt("a_key_lets_one_agent")}
        right={<a className="btn" href="#/integrations">{txt("guided_setup")}</a>}>
        {!admin ? <p className="muted">{txt("ask_an_admin_to_create")}</p> : (<>
          <div className="row"><label className="field grow">{txt("key_name_e_g_the")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={txt("support_agent_production")} /></label><button className="btn primary" disabled={!name.trim()} onClick={create}>{txt("create_key")}</button></div>
          {fresh && <div className="keybox" role="status"><b>{txt("your_new_key_copy_it")}</b><code>{fresh.key}</code><CopyButton text={fresh.key} /></div>}
          {keys.data && (keys.data.items.length === 0 ? <p className="muted">{txt("no_keys_yet")}</p> : <div className="scroll"><table className="tbl"><thead><tr><th>{txt("name")}</th><th>{txt("starts_with")}</th><th>{txt("created")}</th><th>{txt("last_used")}</th><th /></tr></thead><tbody>{keys.data.items.map((k) => (
            <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}…</td><td title={when(k.created_at)}>{timeAgo(k.created_at)} {txt("by_created_by", { created_by: k.created_by })}</td><td>{k.last_used_at ? timeAgo(k.last_used_at) : txt("never")}</td>
              <td>{k.revoked_at ? <span className="row"><span className="badge">{txt("revoked")}</span><ConfirmDelete kind="key" vars={{ name: k.name }} onConfirm={() => teamApi.deleteKey(k.id)} onDone={keys.reload} /></span> : <span className="row"><button className="btn" onClick={() => rotate(k)} title={txt("issue_a_new_key_and")}>{txt("rotate")}</button><button className="btn" onClick={() => revoke(k)}>{txt("revoke")}</button></span>}</td></tr>))}</tbody></table></div>)}
        </>)}
      </Card>
    </div>
  );
}

function Team() {
  const txt = useT("settings");
  const meta = useMeta(), { user } = useAuth(), toast = useToast(), users = useApi(paths.users);
  const [f, setF] = useState({ email: "", name: "", role: "viewer", password: "" }), [reset, setReset] = useState({});
  const call = async (fn, ok) => { try { await fn(); if (ok) toast(ok); users.reload(); } catch (e) { toast(e.message, "bad"); } };
  return (
    <div className="stack">
      <Card title={txt("people")} sub={txt("everyone_who_can_sign_in")}>
        <State loading={users.loading && !users.data} error={users.error} h={120} />
        {users.data && <div className="scroll"><table className="tbl"><thead><tr><th>{txt("person")}</th><th>{txt("role")}</th><th>{txt("active")}</th><th>{txt("last_sign_in")}</th><th>{txt("password")}</th><th /></tr></thead><tbody>{users.data.items.map((u) => (
          <tr key={u.id}><td><b>{u.name}</b> {u.email === user.email && <span className="badge">{txt("you")}</span>}<div className="muted small">{u.email}</div></td>
            <td><select aria-label={txt("role_for_email", { email: u.email })} value={u.role} onChange={(e) => call(() => teamApi.updateUser(u.id, { role: e.target.value }), txt("role_updated"))}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></td>
            <td><Toggle checked={u.is_active} label={txt("active_email", { email: u.email })} onChange={(v) => call(() => teamApi.updateUser(u.id, { is_active: v }), v ? txt("reenabled") : txt("disabled_out"))} /></td>
            <td>{u.last_login_at ? timeAgo(u.last_login_at) : txt("never")}</td>
            <td>{reset[u.id] === undefined ? <button className="btn" onClick={() => setReset({ ...reset, [u.id]: "" })}>{txt("reset")}</button> : <span className="row"><input type="password" aria-label={txt("new_password_for_email", { email: u.email })} placeholder={txt("new_password")} value={reset[u.id]} onChange={(e) => setReset({ ...reset, [u.id]: e.target.value })} /><button className="btn" onClick={() => call(() => teamApi.resetPassword(u.id, reset[u.id]).then(() => setReset({ ...reset, [u.id]: undefined })), txt("pw_reset_done"))}>{txt("set")}</button></span>}</td><td>{u.email !== user.email && <ConfirmDelete kind="user" vars={{ name: u.name || u.email }} onConfirm={() => teamApi.deleteUser(u.id)} onDone={users.reload} />}</td></tr>))}</tbody></table></div>}
        <p className="muted small">{txt("there_must_always_be_at")}</p>
      </Card>
      <Card title={txt("add_a_person")} sub={txt("share_the_password_with_them")}>
        <form className="filters" onSubmit={(e) => { e.preventDefault(); call(() => teamApi.createUser(f).then(() => setF({ email: "", name: "", role: "viewer", password: "" })), txt("person_added")); }}>
          <label className="field">{txt("name")}<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field grow">{txt("email")}<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">{txt("role")}<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          <label className="field">{txt("starting_password")}<input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn primary">{txt("add")}</button></form>
        <p className="muted small">{meta.roles.find((r) => r.key === f.role)?.plain}</p>
      </Card>
    </div>
  );
}

function Account() {
  const txt = useT("settings");
  const { user, authRequired } = useAuth(), meta = useMeta(), toast = useToast();
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" }), [busy, setBusy] = useState(false);
  async function change(e) {
    e.preventDefault();
    if (f.new_password !== f.confirm) return toast(txt("the_new_passwords_don_t"), "bad");
    setBusy(true);
    try { await authApi.changePassword(f.current_password, f.new_password); toast(txt("password_changed_other_devices_were")); setF({ current_password: "", new_password: "", confirm: "" }); }
    catch (e2) { toast(e2.message, "bad"); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <Card title={txt("your_account")}><ul className="plain"><li>{txt("name_2")} <b>{user.name}</b></li><li>{txt("email_2")} <b>{user.email}</b></li><li>{txt("role_2")} <b>{roleLabel(meta, user.role)}</b> — {meta.roles.find((r) => r.key === user.role)?.plain}</li></ul></Card>
      {authRequired ? (
        <Card title={txt("change_your_password")} sub={txt("changing_it_signs_you_out")}><form className="stack narrow" onSubmit={change}>
          <label className="field">{txt("current_password")}<input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" /></label>
          <label className="field">{txt("new_password_2")}<input type="password" required value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" /></label>
          <label className="field">{txt("repeat_new_password")}<input type="password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn primary" disabled={busy}>{busy ? txt("saving") : txt("change_password")}</button></form></Card>
      ) : <Empty title={txt("sign_in_is_turned_off")} icon="🔓"><p className="muted">{txt("there_are_no_passwords_to")}</p></Empty>}
    </div>
  );
}

export default function Settings({ params = {} }) {
  const txt = useT("settings");
  const { allowed } = useAuth(), s = useApi(paths.settings), h = useApi(paths.health);
  const [tab, setTab] = useState(params.tab ?? "overview");
  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);
  const tabs = [{ key: "overview", label: txt("t_overview") }, { key: "safety", label: txt("t_safety") }, { key: "provider", label: txt("t_provider") }, { key: "retention", label: txt("t_retention") }, { key: "keys", label: txt("t_keys") }, ...(allowed("manage_team") ? [{ key: "team", label: txt("t_team") }] : []), { key: "account", label: txt("t_account") }];
  return (
    <div className="stack">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {!s.data ? <State loading={s.loading} error={s.error} h={240} /> : (<>
        {tab === "overview" && <Overview s={s.data} health={h.data} />}
        {tab === "safety" && <Safety s={s.data} reload={s.reload} />}
        {tab === "provider" && <Provider s={s.data} />}
        {tab === "retention" && <Safety s={s.data} reload={s.reload} only="retention" />}
        {tab === "keys" && <ApiKeys />}
        {tab === "team" && allowed("manage_team") && <Team />}
        {tab === "account" && <Account />}
      </>)}
    </div>
  );
}
