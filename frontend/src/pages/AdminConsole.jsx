import { useState } from "react";
import { adminApi, demoApi, fill, paths, settingsApi, useApi, useAuth, useMeta, useText } from "../api";
import ConfirmDelete from "../components/ConfirmDelete";
import { go } from "../router";
import EmptyState from "../components/EmptyState";
import { Card, Kpi, State, useToast } from "../ui";

/** Admin home: people, keys, rules, security events and what each role can do. Sentences come from the server (ui.admin). */
export default function AdminConsole() {
  const toast = useToast(), { allowed } = useAuth(), d = useText("delete"), [busy, setBusy] = useState(false), t = useText("admin"), dbi = useApi(allowed("view_database") ? paths.database : null), meta = useMeta(), users = useApi(paths.users), keys = useApi(paths.apiKeys), rules = useApi(paths.policies), cfg = useApi(paths.settings), sec = useApi(paths.activity({ kind: "security", limit: 6 }));
  const people = users.data?.items ?? [], k = keys.data?.items ?? [], pol = rules.data?.items ?? [];
  const days = cfg.data?.values?.retention_days ?? cfg.data?.config?.retention_days;
  const info = meta.access?.capability_info ?? {};
  return (
    <div className="stack">
      <p className="lead">{t.intro}</p>
      <div className="kpis">
        <Kpi label={t.kpi_people} value={people.length} sub={fill(t.kpi_people_sub, { n: people.filter((u) => u.is_active).length })} />
        <Kpi label={t.kpi_keys} value={k.length} sub={fill(t.kpi_keys_sub, { n: k.filter((x) => !x.revoked_at).length })} />
        <Kpi label={t.kpi_rules} value={pol.length} sub={fill(t.kpi_rules_sub, { n: pol.filter((p) => p.enabled).length })} />
        {days != null && <Kpi label={t.kpi_retention} value={days} sub={t.kpi_retention_sub} />}
      </div>
      <Card title={t.security_title} sub={t.security_sub} right={<button className="btn" onClick={() => go("/history")}>{t.security_cta}</button>}>
        <State loading={sec.loading && !sec.data} error={sec.error} h={80} onRetry={sec.reload} />
        {sec.data && (sec.data.items.length === 0 ? <EmptyState title={t.security_empty} icon="🔒" /> : <ul className="plain">{sec.data.items.map((e) => <li key={e.id}><b>{e.label}</b> <span className="muted small">{e.actor} · {new Date(e.ts).toLocaleString()}</span></li>)}</ul>)}
      </Card>
      <Card title={t.shortcuts_title}><div className="row">
        <button className="btn" onClick={() => go("/settings", { tab: "team" })}>{t.shortcut_team}</button>
        <button className="btn" onClick={() => go("/settings", { tab: "keys" })}>{t.shortcut_keys}</button>
        <button className="btn" onClick={() => go("/settings")}>{t.shortcut_settings}</button>
        <button className="btn" onClick={() => go("/policies")}>{t.shortcut_rules}</button></div></Card>
      {dbi.data && <Card title={t.db_title} sub={t.db_sub}>
        <div className="kpis small"><Kpi label={t.db_engine} value={dbi.data.engine} /><Kpi label={t.db_schema} value={dbi.data.schema_version ?? t.db_unknown} />{dbi.data.size_bytes != null && <Kpi label={t.db_size} value={(dbi.data.size_bytes / 1048576).toFixed(1) + " MB"} />}</div>
        <h4 className="sec">{t.db_counts}</h4>
        <ul className="plain counts">{Object.entries(dbi.data.counts).map(([k, n]) => <li key={k}><b>{n}</b> {t.counts?.[k] ?? k}</li>)}</ul>
        <div className="row"><button className="btn primary" disabled={busy || !dbi.data.backup_supported} onClick={async () => { setBusy(true); try { await adminApi.backup(); toast(t.db_backup_done); } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); } }}>{t.db_backup}</button></div>
        <p className="muted small">{dbi.data.backup_supported ? t.db_backup_note : t.db_no_backup}</p>
      </Card>}
      {allowed("delete_data") && <Card title={t.tidy_title} sub={t.tidy_sub}><div className="row">
        <ConfirmDelete kind="demo" small={false} onConfirm={async () => { const r = await demoApi.remove(); toast(fill(d.demo.done, { n: r.deleted })); dbi.reload(); }} />
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await settingsApi.cleanup(); toast(fill(t.cleanup_done, { n: r.deleted_traces })); dbi.reload(); } catch (e) { toast(e.message, "bad"); } finally { setBusy(false); } }}>{t.cleanup}</button></div></Card>}
      <Card title={t.roles_title} sub={t.roles_sub}>
        {meta.roles.map((r) => <div key={r.key} className="role-row"><b>{r.label}</b><p className="muted">{r.plain}</p>
          <ul className="plain">{Object.values(info).filter((v) => v.min_role === r.key).map((v) => <li key={v.label}>{v.label}</li>)}</ul></div>)}
      </Card>
    </div>
  );
}
