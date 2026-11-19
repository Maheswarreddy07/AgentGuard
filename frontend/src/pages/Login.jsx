import { useState } from "react";
import { authApi, fill, setToken } from "../api";

/** Sign-in screen; in "setup" mode it creates the very first admin account. Text comes from the public status response. */
export default function Login({ mode, status, notice, onAuthed }) {
  const setup = mode === "setup", t = status?.ui?.login ?? {};
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const min = status?.min_password_length ?? 10;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(null);
    if (setup && f.password !== f.confirm) return setErr(t.mismatch);
    if (setup && f.password.length < min) return setErr(fill(t.too_short, { n: min }));
    setBusy(true);
    try {
      const r = setup ? await authApi.setup(f.email, f.password, f.name) : await authApi.login(f.email, f.password);
      setToken(r.token); onAuthed(r.user);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo" aria-hidden="true">🛡</div>
        <h1>{setup ? t.setup_title : t.login_title}</h1>
        <p className="muted">{setup ? t.setup_body : t.login_body}</p>
        {notice && <div role="status" className="callout">{notice}</div>}
        {setup && <label className="field">{t.name}<input value={f.name} onChange={set("name")} autoComplete="name" placeholder={t.name_placeholder} /></label>}
        <label className="field">{t.email}<input type="email" required value={f.email} onChange={set("email")} autoComplete="username" autoFocus /></label>
        <label className="field">{t.password}
          <span className="pw"><input type={show ? "text" : "password"} required value={f.password} onChange={set("password")} autoComplete={setup ? "new-password" : "current-password"} />
            <button type="button" className="linkbtn" onClick={() => setShow(!show)} aria-pressed={show}>{show ? t.hide : t.show}</button></span>
        </label>
        {setup && <label className="field">{t.confirm}<input type={show ? "text" : "password"} required value={f.confirm} onChange={set("confirm")} autoComplete="new-password" /></label>}
        {setup && <p className="muted small">{fill(t.pw_hint, { n: min })}</p>}
        {err && <div role="alert" className="alert">{err}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? t.wait : setup ? t.create : t.submit}</button>
      </form>
    </div>
  );
}
