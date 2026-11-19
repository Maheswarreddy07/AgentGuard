import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setToken } from "../api";
import App from "../App";
import CAT from "./catalog.json";

const META = { categories: { tool_failure: { label: "Tool failed", why: "a tool errored" } }, metrics: {}, actions: { escalate: { icon: "🙋", label: "Hand to a human", plain: "ask a person" } }, severities: ["low", "high"], severity_colors: {}, risk_levels: [], modes: {}, policy_actions: {}, roles: CAT.roles, ui: CAT.ui };
const OPEN = { ui: { login: CAT.ui.login, shell: CAT.ui.shell }, auth_required: true, setup_required: false, session_hours: 12, min_password_length: 10 };
const me = (role) => ({ kind: "user", id: 1, email: "x@x.io", name: "Pat", role });
const SC = { items: [{ id: "s-bad", category: "tool_failure", description: "[SYNTHETIC] a refund failed", n_events: 3, split: "dev", preview: [], labels: { failure_categories: ["tool_failure"], expected_action: "escalate", earliest_detectable_step: 1 } },
  { id: "s-ok", category: "success", description: "all good", n_events: 2, split: "dev", preview: [], labels: { failure_categories: [], expected_action: "none", earliest_detectable_step: null } }] };
const LIBRARY = { kind: "synthetic", groups: [{ key: "safety", tests: [{ key: "k1", group: "safety", name: "Require approval before important actions", summary: "s", checks: "c", expected: "e", also: [], n_cases: 1, scenario_ids: ["s-bad"], technical: [{ id: "s-bad", description: "d", steps: 3, split: "dev", source: "builtin" }], last: null }] }] };
const OV = { agents: { registered: 1, connected: 1 }, suggestions: [], live: { total_runs: 1, successful_runs: 1, pending_approvals: 0, by_severity: {}, recent_incidents: [{ trace_id: "t9", headline: "Refund order 9", task: "t", categories: ["tool_failure"] }] } };

function mockApi(role, extra = {}, ui = CAT.ui) {
  const routes = { "/api/v1/meta": { ...META, ui, access: CAT.access[role] }, "/health": { status: "ok", version: "1" }, "/api/v1/auth/status": OPEN, "/api/v1/auth/me": me(role),
    "/api/v1/approvals?status=pending&limit=1": { pending: 0, items: [], total: 0 }, "/api/v1/approvals?status=pending&limit=5": { pending: 0, items: [], total: 0 }, "/api/v1/risk/monitor?limit=5": { threshold: 50, items: [] },
    "/api/v1/metrics/overview": OV, "/api/v1/agents": { items: [] }, "/api/v1/traces?limit=5": { items: [], total: 0 }, "/api/v1/scenarios": SC, "/api/v1/tests/library": LIBRARY, "/api/v1/scenarios/template": {}, "/api/v1/users": { items: [{ id: 1, email: "x@x.io", role: "admin", is_active: true }] }, "/api/v1/api-keys": { items: [] },
    "/api/v1/policies": { items: [] }, "/api/v1/settings": { values: { retention_days: 30 } }, "/api/v1/history/activity?kind=security&limit=6": { total: 0, items: [], actions: {} }, ...extra };
  globalThis.fetch = vi.fn(async (url) => { const hit = routes[String(url)]; return { ok: hit !== undefined, status: hit !== undefined ? 200 : 404, json: async () => hit ?? { error: { message: "nope" } }, text: async () => "" }; });
}
beforeEach(() => { localStorage.clear(); setToken("t"); window.location.hash = ""; });

test.each([["viewer", "/overview"], ["member", "/overview"], ["admin", "/overview"]])("a %s lands on Home (%s)", async (role, home) => {
  mockApi(role); render(<App />);
  await waitFor(() => expect(window.location.hash).toBe("#" + home));
});

const openAccount = () => fireEvent.click(screen.getByRole("button", { name: CAT.ui.shell.profile_label }));
test("the navigation only offers what the role may open", async () => {
  const S = CAT.ui.shell;
  mockApi("viewer"); window.location.hash = "#/agents"; const first = render(<App />);
  await waitFor(() => screen.getByRole("navigation", { name: S.nav_label })); expect(screen.queryByRole("navigation", { name: S.subnav_label })).toBeNull(); expect(screen.queryByRole("button", { name: /Connect an agent/ })).toBeNull();     // the connect page is for members; a viewer's Agents section has one page, so no tabs
  openAccount(); expect(screen.queryByRole("button", { name: /My work/ })).toBeNull(); expect(screen.queryByRole("button", { name: /Team management/ })).toBeNull(); expect(screen.getByRole("button", { name: /Settings/ })).toBeTruthy(); first.unmount();
  mockApi("member"); window.location.hash = "#/agents"; const second = render(<App />);
  await waitFor(() => screen.getByRole("navigation", { name: S.subnav_label })); expect(within(screen.getByRole("navigation", { name: S.subnav_label })).getByRole("button", { name: /Connect an agent/ })).toBeTruthy();
  openAccount(); expect(screen.queryByRole("button", { name: /My work/ })).toBeNull(); expect(screen.queryByRole("button", { name: /Team management/ })).toBeNull(); second.unmount();
  mockApi("admin"); window.location.hash = "#/agents"; render(<App />); await waitFor(() => screen.getByRole("navigation", { name: S.nav_label })); openAccount(); expect(screen.getByRole("button", { name: /Team management/ })).toBeTruthy();
});

test("there is one interface: the account menu has no Simple/Advanced or demo-data switch", async () => {
  const S = CAT.ui.shell; mockApi("admin"); window.location.hash = "#/scenarios"; render(<App />);
  await waitFor(() => screen.getByRole("navigation", { name: S.nav_label })); openAccount();
  const dlg = screen.getByRole("dialog", { name: S.profile_label });
  expect(within(dlg).queryByText(/Simple|Advanced|Demo data|Real activity/i)).toBeNull(); expect(within(dlg).getByRole("button", { name: /Settings/ })).toBeTruthy(); expect(within(dlg).getByRole("button", { name: S.sign_out })).toBeTruthy();
  expect(localStorage.getItem("ag.mode")).toBeNull();
});

test("opening a page your role does not include shows a clear explanation and a way home", async () => {
  mockApi("viewer"); window.location.hash = "#/admin"; render(<App />);
  await waitFor(() => screen.getByText(CAT.ui.access.denied_title));
  expect(screen.getByRole("button", { name: CAT.ui.access.denied_action })).toBeTruthy(); expect(screen.queryByText("Recent security events")).toBeNull();
});

test("admin console shows people, keys and the security log", async () => {
  mockApi("admin"); window.location.hash = "#/admin"; render(<App />);
  await waitFor(() => screen.getByText(CAT.ui.admin.security_title));
  expect(screen.getByText(CAT.ui.admin.roles_title)).toBeTruthy(); expect(screen.getByText(CAT.ui.admin.kpi_people)).toBeTruthy();
});

test("the Test Library has no wording of its own: change the server text and the page follows", async () => {
  const ui = { ...CAT.ui, tests: { ...CAT.ui.tests, library: { ...CAT.ui.tests.library, intro: "ZZ Intro from server", not_tested: "ZZ Never run" }, groups: { ...CAT.ui.tests.groups, safety: { label: "ZZ Safety group", sub: "x" } } } };
  mockApi("viewer", {}, ui); window.location.hash = "#/scenarios"; render(<App />);
  await waitFor(() => screen.getByText("ZZ Intro from server"));
  expect(screen.getByText("ZZ Safety group")).toBeTruthy(); expect(screen.getAllByText("ZZ Never run").length).toBeGreaterThan(0);
});
