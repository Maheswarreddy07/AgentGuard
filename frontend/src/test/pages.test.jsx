import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { setToken } from "../api";
import App from "../App";

import CAT from "./catalog.json";
const META = { access: CAT.access.admin, ui: CAT.ui, categories: { unauthorized_action: { label: "Action without approval", why: "ran with no approval" }, workflow_invariant_violation: { label: "Steps out of order" } }, metrics: {}, actions: {}, severities: ["info", "low", "medium", "high", "critical"],
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

test("the top navigation shows the six sections and the Agents page opens an agent's runs", async () => {
  window.location.hash = "#/agents";
  mockApi({ ...base, "/api/v1/agents": { items: [{ id: 1, name: "support", description: "Refund agent", environment: "prod", runs: 4, flagged_runs: 1, blocked_actions: 1, avg_risk: 20, last_seen_at: "2026-01-01T00:00:00", connection: "connected", quiet_after_days: 7, integration: "sdk", open_problems: 2, open_serious: 1, recent_activity: [{ trace_id: "t1", headline: "Refunded order 5", at: "2026-01-01T00:00:00" }] }] } });
  render(<App />);
  await waitFor(() => screen.getByText("Refund agent"));
  const top = within(screen.getByRole("navigation", { name: CAT.ui.shell.nav_label })); for (const s of CAT.access.admin.sections) expect(top.getByRole("button", { name: new RegExp("^" + s.label) })).toBeTruthy();
  expect(top.getByRole("button", { name: /^Agents/ }).getAttribute("aria-current")).toBe("page"); expect(within(screen.getByRole("navigation", { name: CAT.ui.shell.subnav_label })).getByRole("button", { name: /Connect an agent/ })).toBeTruthy();
  expect(screen.getByText(CAT.ui.agents.connection.connected.label)).toBeTruthy();
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

const PB = (o = {}) => ({ id: "f1", trace_id: "run-7", agent: "support", severity: "critical", group: "critical", category: "unauthorized_action", confirmed: true, rule: "approval_before_consequential", event_id: "e2", detected_at: "2026-01-01T00:00:00", resolved_at: null,
  what_happened: "A refund ran without approval.", why_it_matters: "Money moved with no human check.", what_agentguard_did: { key: "blocked", tool: "issue_refund", rule: "Refund limit" }, next_steps: ["Require approval for refunds."], evidence: { amount: 500 }, ...o });
const COUNTS = { critical: 1, warning: 0, resolved: 0 };

test("Problems answer the five questions, group by urgency and keep the evidence behind a toggle", async () => {
  window.location.hash = "#/problems"; const T = CAT.ui.problems;
  mockApi({ ...base, "/api/v1/problems?group=critical&limit=100": { counts: COUNTS, total: 1, items: [PB()] }, "/api/v1/problems?limit=1": { counts: COUNTS, total: 1, items: [] } });
  render(<App />);
  await waitFor(() => screen.getByText("A refund ran without approval."));
  for (const q of Object.values(T.q)) expect(screen.getByText(q)).toBeTruthy();
  expect(screen.getByText("Money moved with no human check.")).toBeTruthy(); expect(screen.getByText(/stopped the action “issue_refund”/)).toBeTruthy(); expect(screen.getByText("Require approval for refunds.")).toBeTruthy(); expect(screen.getByText(T.confirmed)).toBeTruthy();
  expect(screen.queryByText(/"amount": 500/)).toBeNull(); fireEvent.click(screen.getByRole("button", { name: T.evidence_show })); expect(screen.getByText(/"amount": 500/)).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Critical/ }).textContent).toContain("1");
});

test("a member resolves a problem with a note; it can be reopened; the other groups have their own empty messages", async () => {
  window.location.hash = "#/problems"; const T = CAT.ui.problems; let resolved = false;
  mockApi({ ...base, "/api/v1/problems?group=critical&limit=100": () => ({ counts: COUNTS, total: 1, items: [PB()] }), "/api/v1/problems?limit=1": { counts: COUNTS, total: 1, items: [] },
    "/api/v1/problems/f1/resolve": () => { resolved = true; return { resolved: true }; }, "/api/v1/problems?group=resolved&limit=100": { counts: COUNTS, total: 0, items: [] } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: T.resolve })); fireEvent.change(screen.getByLabelText(T.note_label), { target: { value: "fixed the tool" } }); fireEvent.click(screen.getByRole("button", { name: T.save }));
  await waitFor(() => expect(resolved).toBe(true)); expect(JSON.parse(calls.find((c) => c.url.endsWith("/resolve")).init.body)).toEqual({ note: "fixed the tool" });
  fireEvent.click(screen.getByRole("tab", { name: /Resolved/ })); expect(await screen.findByText(T.empty_group.resolved)).toBeTruthy();
});

test("with no problems at all the page says so plainly", async () => {
  window.location.hash = "#/problems";
  mockApi({ ...base, "/api/v1/problems?group=critical&limit=100": { counts: { critical: 0, warning: 0, resolved: 0 }, total: 0, items: [] }, "/api/v1/problems?limit=1": { counts: { critical: 0, warning: 0, resolved: 0 }, total: 0, items: [] } });
  render(<App />); expect(await screen.findByText(CAT.ui.problems.empty_none)).toBeTruthy();
});

test("the Activity timeline reads as sentences, groups by day, links to the run and loads earlier activity", async () => {
  window.location.hash = "#/activity"; const T = CAT.ui.activity, now = new Date().toISOString();
  mockApi({ ...base, "/api/v1/activity/timeline?runs=15&offset=0": { runs: 15, offset: 0, next_offset: 15, items: [
      { kind: "action_blocked", ts: now, trace_id: "run-1", agent: "support", tool: "issue_refund", rule: "Refund limit" }, { kind: "approval_decided", ts: now, trace_id: "run-1", agent: "support", tool: "issue_refund", status: "approved", by: "ada@x.io" },
      { kind: "recovery_completed", ts: now, trace_id: "run-1", agent: "support", ok: true }, { kind: "task_started", ts: now, trace_id: "run-1", agent: "support", task: "Refund order 5" }] },
    "/api/v1/activity/timeline?runs=15&offset=15": { runs: 0, offset: 15, next_offset: null, items: [] } });
  render(<App />);
  expect(await screen.findByText("support’s action “issue_refund” was blocked")).toBeTruthy(); expect(screen.getByText("Approval for “issue_refund” was approved by ada@x.io")).toBeTruthy(); expect(screen.getByText("Recovery worked")).toBeTruthy(); expect(screen.getByText("support started a task")).toBeTruthy();
  expect(screen.getByText(T.today)).toBeTruthy(); fireEvent.click(screen.getAllByRole("button", { name: new RegExp(T.details) })[0]); expect(window.location.hash).toBe("#/traces/run-1");
  window.location.hash = "#/activity"; fireEvent.click(await screen.findByRole("button", { name: T.earlier })); expect(await screen.findByText(T.end)).toBeTruthy();
});

test("an empty timeline says there is no activity yet", async () => {
  window.location.hash = "#/activity"; mockApi({ ...base, "/api/v1/activity/timeline?runs=15&offset=0": { runs: 0, offset: 0, next_offset: null, items: [] } });
  render(<App />); expect(await screen.findByText(CAT.ui.activity.empty)).toBeTruthy();
});

test("agent cards show how each agent is connected, its recent activity and its open problems", async () => {
  window.location.hash = "#/agents"; const T = CAT.ui.agents;
  mockApi({ ...base, "/api/v1/agents": { items: [{ id: 1, name: "support", environment: "prod", runs: 4, flagged_runs: 1, blocked_actions: 0, avg_risk: 20, last_seen_at: "2026-01-01T00:00:00", connection: "connected", quiet_after_days: 7, integration: "sdk", open_problems: 2, open_serious: 1, recent_activity: [{ trace_id: "t1", headline: "Refunded order 5", at: "2026-01-01T00:00:00" }] },
    { id: 2, name: "new-bot", environment: "prod", runs: 0, flagged_runs: 0, blocked_actions: 0, avg_risk: null, last_seen_at: null, connection: "waiting", quiet_after_days: 7, integration: null, open_problems: 0, open_serious: 0, recent_activity: [] }] } });
  render(<App />);
  expect(await screen.findByText(T.connection.connected.label)).toBeTruthy(); expect(screen.getByText(T.integration.sdk)).toBeTruthy(); expect(screen.getByText(/2 open problem/)).toBeTruthy(); expect(screen.getByText(/Refunded order 5/)).toBeTruthy();
  expect(screen.getByText(T.connection.waiting.label)).toBeTruthy(); expect(screen.getByText(T.integration.none)).toBeTruthy(); expect(screen.getByText(T.problems_none)).toBeTruthy();
});

test("Connect an agent: three ways in; guided path registers, makes a key, offers the file, and confirms the connection", async () => {
  window.location.hash = "#/integrations?way=mine"; let runs = 0; const T = CAT.ui.connect;
  mockApi({ ...base, "/api/v1/meta": { ...META, sample_runs: [{ key: "normal", label: "A normal run", plain: "p" }] }, "/api/v1/settings": { fields: [], rules: [], system: { connect: { install: "pip install -e sdk", snippet: 'api_key="YOUR_API_KEY" agent_name="AGENT_NAME"', base_url: "http://api" } } },
    "/api/v1/agents": (u, i) => (i.method === "POST" ? { id: 2, name: "refund-bot" } : { items: runs ? [{ id: 2, name: "refund-bot", environment: "production", runs, flagged_runs: 0, blocked_actions: 0, avg_risk: 0, last_seen_at: "2026-01-01T00:00:00" }] : [] }),
    "/api/v1/agents/starter?name=refund-bot": { filename: "agentguard_refund-bot.py", content: 'KEY = "PASTE_YOUR_KEY_HERE"', server: "http://api" },
    "/api/v1/api-keys": { id: 9, name: "refund-bot (guided setup)", key: "ag_live_secret", prefix: "ag_live_se" } });
  render(<App />);
  fireEvent.change(await screen.findByLabelText(new RegExp(T.agent_label)), { target: { value: "refund-bot" } });
  fireEvent.click(screen.getByRole("button", { name: T.mine.steps[0].button }));
  fireEvent.click(await screen.findByRole("button", { name: T.mine.steps[1].button }));
  expect(await screen.findByText("ag_live_secret")).toBeTruthy();
  const post = calls.find((c) => c.url === "/api/v1/agents" && c.init.method === "POST"); expect(JSON.parse(post.init.body).name).toBe("refund-bot");
  fireEvent.click(screen.getByRole("button", { name: T.next })); fireEvent.click(await screen.findByRole("button", { name: new RegExp(T.mine.steps[2].button) }));
  fireEvent.click(screen.getByRole("button", { name: T.next })); expect(screen.getByText(T.mine.steps[3].python_title)).toBeTruthy(); expect(screen.getByText(/python agentguard_refund-bot\.py/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: T.mine.steps[3].next })); expect(await screen.findByText(/Waiting for the first run/)).toBeTruthy();
  runs = 3; fireEvent.click(screen.getByRole("button", { name: T.mine.steps[4].again })); expect(await screen.findByText(/has sent 3 run/)).toBeTruthy();
});

test("Connect an agent: the first screen offers the three ways in, and the try-it path runs a sample and explains the result", async () => {
  window.location.hash = "#/integrations"; const T = CAT.ui.connect;
  mockApi({ ...base, "/api/v1/meta": { ...META, sample_runs: [{ key: "normal", label: "A normal run", plain: "p" }] }, "/api/v1/settings": { fields: [], rules: [], system: { connect: { install: "i", snippet: "s", base_url: "b" } } }, "/api/v1/agents": (u, i) => (i.method === "POST" ? { id: 1 } : { items: [] }),
    "/api/v1/agents/my-first-agent/sample-run": { trace_id: "sample-normal-1", findings: 2, headline: "Refund ran without approval", categories: ["unauthorized_action"], simulated: true } });
  render(<App />);
  for (const c of T.choices) expect(await screen.findByText(c.title)).toBeTruthy();
  fireEvent.click(screen.getByText(T.choices[0].title)); fireEvent.click(await screen.findByRole("button", { name: T.try.run }));
  expect(await screen.findByText(/AgentGuard noticed 2 problem/)).toBeTruthy(); expect(calls.some((c) => c.url.endsWith("/sample-run") && JSON.parse(c.init.body).sample === "normal")).toBe(true);
});

test("API keys tab lets an admin rotate a key and shows the new one once", async () => {
  window.location.hash = "#/settings?tab=keys";
  mockApi({ ...base, "/api/v1/settings": { fields: [], rules: [], system: { connect: {}, ai: {}, redaction: [] } }, "/api/v1/api-keys": (u, i) => (i.method === "POST" ? { id: 2, name: "prod", key: "ag_rotated_new", replaces: 1 } : { items: [{ id: 1, name: "prod", prefix: "ag_old", created_by: "ada@x.io", created_at: "2026-01-01T00:00:00", last_used_at: null, revoked_at: null }] }),
    "/api/v1/api-keys/1/rotate": { id: 2, name: "prod", key: "ag_rotated_new", replaces: 1 } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Rotate" }));
  expect(await screen.findByText("ag_rotated_new")).toBeTruthy(); expect(calls.some((c) => c.url === "/api/v1/api-keys/1/rotate" && c.init.method === "POST")).toBe(true);
});
