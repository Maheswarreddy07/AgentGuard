import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { setToken } from "../api";
import App from "../App";

const META = { categories: { unauthorized_action: { label: "Action without approval", why: "ran with no approval" }, workflow_invariant_violation: { label: "Steps out of order" } }, metrics: {}, actions: {}, severities: ["info", "low", "medium", "high", "critical"],
  severity_colors: { critical: "#f00", high: "#f90", medium: "#fe0", low: "#00f", info: "#888" }, roles: [{ key: "viewer", label: "Viewer", plain: "" }, { key: "member", label: "Member", plain: "" }, { key: "admin", label: "Admin", plain: "" }], modes: {}, policy_actions: {} };
const AUTH = { auth_required: true, setup_required: false, session_hours: 12, min_password_length: 10 };
const ME = { kind: "user", id: 1, email: "ada@x.io", name: "Ada", role: "admin" };
let calls;
function mockApi(routes) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init }); const key = Object.keys(routes).find((k) => k === url || (k.endsWith("*") && String(url).startsWith(k.slice(0, -1))));
    const hit = key === undefined ? undefined : typeof routes[key] === "function" ? routes[key](url, init) : routes[key];
    return { ok: hit !== undefined, status: hit !== undefined ? 200 : 404, json: async () => hit ?? { error: { message: "nope" } }, text: async () => "" };
  });
}
const base = { "/api/v1/meta": META, "/health": { status: "ok", version: "1" }, "/api/v1/auth/status": AUTH, "/api/v1/auth/me": ME, "/api/v1/approvals?status=pending&limit=1": { pending: 0, items: [], total: 0 } };
beforeEach(() => { localStorage.clear(); setToken("t"); });

test("sidebar groups the pages and the Agents page opens an agent's runs", async () => {
  window.location.hash = "#/agents";
  mockApi({ ...base, "/api/v1/agents": { items: [{ id: 1, name: "support", description: "Refund agent", environment: "prod", runs: 4, flagged_runs: 1, blocked_actions: 1, avg_risk: 20, last_seen_at: "2026-01-01T00:00:00" }] } });
  render(<App />);
  await waitFor(() => screen.getByText("Refund agent"));
  for (const g of ["Monitor", "Protect", "Prove it works", "Manage"]) expect(screen.getByText(g)).toBeTruthy();
  expect(screen.getByText("Some problems")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open runs of support" }));
  expect(window.location.hash).toBe("#/traces?agent=support");
});

test("empty Agents page points to the wizard", async () => {
  window.location.hash = "#/agents";
  mockApi({ ...base, "/api/v1/agents": { items: [] } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect your first agent" }));
  expect(window.location.hash).toBe("#/integrations");
});

const FINDING = { id: "f1", trace_id: "run-7", label: "Action without approval", severity: "critical", description: "A refund ran without approval.", source: "rule", detected_at: "2026-01-01T00:00:00", confidence: 1 };
test("Problems page lists problems and the drawer shows why it matters, with the evidence tucked away", async () => {
  window.location.hash = "#/problems";
  mockApi({ ...base, "/api/v1/findings?limit=15&offset=0": { total: 1, items: [FINDING] },
    "/api/v1/findings/f1": { ...FINDING, why: "Money moved with no human check.", fix: "Require approval.", evidence_event_ids: ["e2"], evidence_events: [{ event_id: "e2", step_index: 2 }], context_events: [{ event_id: "e2", step_index: 2 }], run: { task: "Refund order" }, localization: { resolved: true, first_detectable_step: 2, origin_event_id: null } } });
  render(<App />);
  await waitFor(() => screen.getByText("A refund ran without approval."));
  fireEvent.click(screen.getByRole("button", { name: "See details" }));
  const dlg = await screen.findByRole("dialog");
  await waitFor(() => within(dlg).getByText(/Money moved with no human check/));
  expect(within(dlg).getByText(/task: Refund order/)).toBeTruthy(); expect(within(dlg).getByText(/origin not determinable/)).toBeTruthy(); expect(within(dlg).getByText(/the exact events/).closest("details").open).toBe(false);
  fireEvent.click(within(dlg).getByRole("button", { name: "Close ✕" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("Problems filters ask the API for just that severity", async () => {
  window.location.hash = "#/problems";
  mockApi({ ...base, "/api/v1/findings?limit=15&offset=0": { total: 1, items: [FINDING] }, "/api/v1/findings?limit=15&offset=0&severity=high": { total: 0, items: [] } });
  render(<App />);
  await waitFor(() => screen.getByText("A refund ran without approval."));
  fireEvent.click(screen.getByRole("button", { name: "high" }));
  await waitFor(() => screen.getByText("No problems found")); expect(screen.getByText(/Nothing matches these filters/)).toBeTruthy();
});

test("Connect an agent: register, create a key, get a filled-in snippet, and see the connection confirmed", async () => {
  window.location.hash = "#/integrations"; let runs = 0;
  mockApi({ ...base, "/api/v1/settings": { fields: [], rules: [], system: { connect: { install: "pip install -e sdk", snippet: 'guard = AgentGuard(api_key="YOUR_API_KEY")\nguard.trace(agent_name="AGENT_NAME")', base_url: "http://api" } } },
    "/api/v1/agents": (u, i) => (i.method === "POST" ? { id: 2, name: "refund-bot" } : { items: runs ? [{ id: 2, name: "refund-bot", environment: "production", runs, flagged_runs: 0, blocked_actions: 0, avg_risk: 0, last_seen_at: "2026-01-01T00:00:00" }] : [] }),
    "/api/v1/api-keys": { id: 9, name: "refund-bot (wizard)", key: "ag_live_secret", prefix: "ag_live_se" } });
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Agent name"), { target: { value: "refund-bot" } });
  fireEvent.click(screen.getByRole("button", { name: "Register this agent" }));
  fireEvent.click(await screen.findByRole("button", { name: /Create a key for “refund-bot”/ }));
  expect(await screen.findByText("ag_live_secret")).toBeTruthy();
  const post = calls.find((c) => c.url === "/api/v1/agents" && c.init.method === "POST"); expect(JSON.parse(post.init.body).name).toBe("refund-bot");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText(/api_key="ag_live_secret"/)).toBeTruthy(); expect(screen.getByText(/agent_name="refund-bot"/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /check/ })); expect(await screen.findByText(/Waiting for the first run/)).toBeTruthy();
  runs = 3; fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText(/Connected\./)).toBeTruthy(); expect(screen.getByText(/has sent 3 runs/)).toBeTruthy();
});

test("API keys tab lets an admin rotate a key and shows the new one once", async () => {
  window.location.hash = "#/settings?tab=keys";
  mockApi({ ...base, "/api/v1/settings": { fields: [], rules: [], system: { connect: {}, ai: {}, redaction: [] } }, "/api/v1/api-keys": (u, i) => (i.method === "POST" ? { id: 2, name: "prod", key: "ag_rotated_new", replaces: 1 } : { items: [{ id: 1, name: "prod", prefix: "ag_old", created_by: "ada@x.io", created_at: "2026-01-01T00:00:00", last_used_at: null, revoked_at: null }] }),
    "/api/v1/api-keys/1/rotate": { id: 2, name: "prod", key: "ag_rotated_new", replaces: 1 } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Rotate" }));
  expect(await screen.findByText("ag_rotated_new")).toBeTruthy(); expect(calls.some((c) => c.url === "/api/v1/api-keys/1/rotate" && c.init.method === "POST")).toBe(true);
});
