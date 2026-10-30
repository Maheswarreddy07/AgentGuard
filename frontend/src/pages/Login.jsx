import { useState } from "react";
import { api, setToken } from "../api";

/** Sign-in screen; in "setup" mode it creates the very first admin account. */
export default function Login({ mode, status, notice, onAuthed }) {
  const setup = mode === "setup";
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const min = status?.min_password_length ?? 10;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(null);
    if (setup && f.password !== f.confirm) return setErr("The two passwords don’t match.");
    if (setup && f.password.length < min) return setErr(`Use at least ${min} characters.`);
    setBusy(true);
    try {
      const r = await api(setup ? "/api/v1/auth/setup" : "/api/v1/auth/login", { method: "POST", body: JSON.stringify(setup ? { email: f.email, password: f.password, name: f.name } : { email: f.email, password: f.password }) });
      setToken(r.token); onAuthed(r.user);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo" aria-hidden="true">🛡</div>
        <h1>{setup ? "Welcome to AgentGuard" : "Sign in"}</h1>
        <p className="muted">{setup ? "First-time setup: create the administrator account. You’ll use it to invite your team and manage settings." : "Use your AgentGuard account to continue."}</p>
        {notice && <div role="status" className="callout">{notice}</div>}
        {setup && <label className="field">Your name<input value={f.name} onChange={set("name")} autoComplete="name" placeholder="Ada Lovelace" /></label>}
        <label className="field">Email<input type="email" required value={f.email} onChange={set("email")} autoComplete="username" autoFocus /></label>
        <label className="field">Password
          <span className="pw"><input type={show ? "text" : "password"} required value={f.password} onChange={set("password")} autoComplete={setup ? "new-password" : "current-password"} />
            <button type="button" className="linkbtn" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button></span>
        </label>
        {setup && <label className="field">Confirm password<input type={show ? "text" : "password"} required value={f.confirm} onChange={set("confirm")} autoComplete="new-password" /></label>}
        {setup && <p className="muted small">At least {min} characters. Passwords are stored as salted hashes, never in plain text.</p>}
        {err && <div role="alert" className="alert">{err}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? "Please wait…" : setup ? "Create admin account" : "Sign in"}</button>
      </form>
    </div>
  );
}
