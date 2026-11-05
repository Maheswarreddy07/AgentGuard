/** Left navigation. `groups` = [{ label, items: [{ path, icon, label }] }]; `badges` = { [path]: number }. */
export default function AppSidebar({ groups, active, onNavigate, user, roleName, authRequired, onSignOut, apiStatus, badges = {} }) {
  return (
    <aside className="side">
      <div className="brand"><span className="logo" aria-hidden="true">🛡</span> AgentGuard</div>
      <nav aria-label="Main">
        {groups.map((g) => (
          <div key={g.label} className="nav-group">
            <div className="nav-h">{g.label}</div>
            {g.items.map((it) => (
              <button key={it.path} className={"nav" + (it.path === active ? " on" : "")} aria-current={it.path === active ? "page" : undefined} onClick={() => onNavigate(it.path)}>
                <span aria-hidden="true">{it.icon}</span>{it.label}
                {badges[it.path] > 0 && <span className="nav-b" aria-label={`${badges[it.path]} waiting`}>{badges[it.path]}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <div className="me">
          <span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span>
          <div><div className="me-n">{user.name || user.email}</div><div className="muted small">{authRequired ? roleName : "Local mode — sign-in is off"}</div></div>
        </div>
        {authRequired && <button className="btn" onClick={onSignOut}>Sign out</button>}
        <div className="status-line"><span className={"dot " + (apiStatus === "up" ? "up" : apiStatus === "down" ? "down" : "")} />{apiStatus === "checking" ? "Checking…" : apiStatus === "up" ? "API connected" : "API unreachable"}</div>
      </div>
    </aside>
  );
}
