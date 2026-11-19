import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuthCtx, MetaCtx, setToken } from "../api";
import App from "../App";
import Scenarios from "../pages/Scenarios";
import RunTests from "../pages/RunTests";
import Results from "../pages/Results";
import Flow from "../components/Flow";

import CAT from "./catalog.json";
const META = { access: CAT.access.admin, ui: CAT.ui, categories: { unauthorized_action: { label: "Action without approval", why: "ran without approval" }, a: { label: "Category A" } }, metrics: { recall: { label: "Recall", plain: "caught" }, precision: { plain: "right" } },
  actions: { escalate: { label: "Hand to a human", icon: "🙋", plain: "A person must take over." }, none: { label: "No action needed", icon: "✓", plain: "" } }, severities: ["low", "medium", "high", "critical"],
  severity_colors: { critical: "#ff0000", high: "#ff9900", medium: "#ffee00", low: "#0000ff" },
  roles: [{ key: "viewer", label: "Viewer", plain: "look only" }, { key: "member", label: "Member", plain: "can run things" }, { key: "admin", label: "Admin", plain: "everything" }] };
const OPEN = { ui: { login: CAT.ui.login, shell: CAT.ui.shell }, auth_required: false, setup_required: false, session_hours: 12, min_password_length: 10 };
const ADMIN = { kind: "user", id: 1, email: "ada@x.io", name: "Ada", role: "admin" };
const OPS = { successful_runs: 3, failed_runs: 1, blocked_runs: 0, running_runs: 0, risky_runs: 1, critical_runs: 1, blocked_actions: 2, pending_approvals: 1, recovery_attempts: 0, avg_duration_ms: 1500, avg_risk: 12.5, total_cost_usd: 0.25 };
const OV = { agents: { registered: 2, connected: 1 }, suggestions: [{ key: "review_approvals", n: 1, path: "/approvals" }], live: { ...OPS, total_runs: 4, runs_with_findings: 1, clean_runs: 3, failure_rate: 0.25, by_category: { unauthorized_action: 1 }, category_stats: { unauthorized_action: { count: 1, max_severity: "critical" } }, by_severity: { critical: 1 },
  recent_incidents: [{ trace_id: "t1", agent_name: "a", created_at: "2026-01-01T00:00:00", n_events: 3, status: "flagged", max_severity: "critical", categories: ["unauthorized_action"], headline: "Refund ran without approval" }] }, benchmark: null };
const SETTINGS = { fields: [
  { key: "max_retries", label: "Automatic retries allowed", group: "safety", group_label: "Recovery safety", unit: "attempts", min: 1, max: 10, default: 3, value: 3, modified: false, help: "How many times to retry." },
  { key: "zeta_limit", label: "Zeta limit", group: "safety", group_label: "Recovery safety", unit: "zetas", min: 0, max: 50, default: 7, value: 7, modified: false, help: "A setting the UI has never heard of." }],
  rules: [{ key: "tool_failure", label: "Tool failures", description: "Flags errors.", needs: "nothing extra", enabled: true }],
  system: { version: "9.9", auth_required: true, session_hours: 12, ai: { enabled: false, provider: null }, max_events_per_request: 500, redaction: ["passwords"], connect: { base_url: "http://api.test", snippet: "code YOUR_API_KEY", install: "pip install thing" } } };

let calls;
function mockApi(routes) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => k === url || (k.endsWith("*") && String(url).startsWith(k.slice(0, -1))));
    const hit = key === undefined ? undefined : typeof routes[key] === "function" ? routes[key](url, init) : routes[key];
    const ok = hit !== undefined && !(hit && hit.__status);
    return { ok, status: ok ? 200 : hit?.__status ?? 404, json: async () => (ok ? hit : hit?.body ?? { error: { message: "nope" } }), text: async () => "" };
  });
}
const base = { "/api/v1/meta": META, "/health": { status: "ok", database: "ok", version: "9.9" }, "/api/v1/agents": { items: [{ id: 1, name: "support", environment: "prod", runs: 4, flagged_runs: 1, blocked_actions: 0, avg_risk: 10, last_seen_at: "2026-01-01T00:00:00" }] },
  "/api/v1/traces?limit=5": { items: [{ trace_id: "t1", headline: "Refund ran without approval", agent_name: "support", outcome: "failed", status: "flagged", created_at: "2026-01-01T00:00:00" }], total: 1 } };
beforeEach(() => { localStorage.clear(); window.location.hash = ""; });

test("first run: creates the admin account and signs in", async () => {
  window.location.hash = "#/overview";
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true, setup_required: true }, "/api/v1/auth/setup": { token: "tok", user: ADMIN }, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome to AgentGuard" })).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@x.io" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-battery" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Create admin account" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/don’t match/);
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "correct-horse-battery" } });
  fireEvent.click(screen.getByRole("button", { name: "Create admin account" }));
  await waitFor(() => expect(screen.getByText("Refund ran without approval")).toBeTruthy());
  expect(localStorage.getItem("agentguard.token")).toBe("tok");
});

test("sign-in shows the server's error and never reveals which part was wrong", async () => {
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/login": { __status: 401, body: { error: { message: "Incorrect email or password." } } } });
  render(<App />);
  await waitFor(() => screen.getByRole("heading", { name: "Sign in" }));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@x.io" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "whatever-pass" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Incorrect email or password.");
  expect(localStorage.getItem("agentguard.token")).toBeNull();
});

test("an expired session sends you back to sign-in with an explanation", async () => {
  window.location.hash = "#/overview";
  setToken("old");
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/me": ADMIN, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => screen.getByText("Refund ran without approval"));
  window.dispatchEvent(new Event("ag-unauth"));
  await waitFor(() => expect(screen.getByText(/session ended/)).toBeTruthy());
  expect(localStorage.getItem("agentguard.token")).toBeNull();
});

test("local mode (sign-in off) goes straight to the app and says so", async () => {
  window.location.hash = "#/overview";
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => expect(screen.getByText("Refund ran without approval")).toBeTruthy());
  expect(screen.getByText(/sign-in is off/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

test("overview uses human labels from the API and links incidents", async () => {
  window.location.hash = "/overview"; mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await screen.findByText("Refund ran without approval");
  expect(screen.getAllByText(/Action without approval/).length).toBeGreaterThan(0); expect(screen.queryByText("unauthorized_action")).toBeNull();
  expect(screen.getByText(new RegExp(CAT.ui.overview.fix_open)).closest("a").getAttribute("href")).toBe("#/traces/t1");
  const O = CAT.ui.overview; for (const k of ["tile_agents", "tile_tasks", "tile_problems", "tile_waiting"]) expect(screen.getByText(O[k].label)).toBeTruthy(); expect(screen.queryByText("Estimated cost")).toBeNull();     // four numbers, nothing else
  expect(await screen.findByText(O.suggestions.review_approvals.cta)).toBeTruthy(); expect(await screen.findByText(O.health_title)).toBeTruthy(); expect(await screen.findByText(/support/)).toBeTruthy(); expect(await screen.findByText(O.activity_title)).toBeTruthy();
  expect(screen.queryByText(O.more_show)).toBeNull();     // the full report is an Advanced-mode extra
});

test("settings are rendered from the API (nothing hardcoded) and saved as a diff", async () => {
  setToken("t"); window.location.hash = "#/settings?tab=safety";
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/me": ADMIN, "/api/v1/settings": (u, i) => (i.method === "PUT" ? { ...SETTINGS, changes: ["Zeta limit: 9"] } : SETTINGS) });
  render(<App />);
  await waitFor(() => screen.getByText("Zeta limit"));
  expect(screen.getByText("A setting the UI has never heard of.")).toBeTruthy(); expect(screen.getByText("Tool failures")).toBeTruthy();
  expect(screen.queryByText(/unsaved/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Zeta limit (number)"), { target: { value: "9" } });
  expect(await screen.findByText("You have unsaved changes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(calls.some((c) => c.init.method === "PUT")).toBe(true));
  const put = calls.find((c) => c.init.method === "PUT"); expect(JSON.parse(put.init.body).values).toEqual({ zeta_limit: 9 });
  expect(put.init.headers.Authorization).toBe("Bearer t");
});

test("Settings has separate AI provider and Data retention tabs, each showing only its own settings", async () => {
  setToken("t"); window.location.hash = "#/settings?tab=safety"; const S = CAT.ui.strings.settings;
  const withData = { ...SETTINGS, fields: [...SETTINGS.fields, { key: "retention_days", label: "Keep activity for", group: "data", group_label: "Data retention", unit: "days", min: 0, max: 3650, default: 0, value: 30, modified: true, help: "Older runs are deleted." }] };
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/me": ADMIN, "/api/v1/settings": withData });
  render(<App />); await waitFor(() => screen.getByText("Zeta limit"));
  expect(screen.queryByText("Keep activity for")).toBeNull();                                  // retention is not mixed into safety settings
  fireEvent.click(screen.getByRole("tab", { name: S.t_provider })); await waitFor(() => screen.getByText(S.provider_how)); expect(screen.getByText(S.provider_off)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: S.t_retention })); await waitFor(() => screen.getByText("Keep activity for"));
  expect(screen.queryByText("Zeta limit")).toBeNull(); expect(screen.queryByText("Tool failures")).toBeNull();      // and safety settings are not mixed into retention
});

test("non-admins see settings read-only and no Team tab", async () => {
  setToken("t"); window.location.hash = "#/settings?tab=safety";
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/me": { ...ADMIN, role: "viewer" }, "/api/v1/meta": { ...META, access: CAT.access.viewer }, "/api/v1/settings": SETTINGS });
  render(<App />);
  await waitFor(() => screen.getByText("Zeta limit"));
  expect(screen.getByText(/only admins can change/)).toBeTruthy(); expect(screen.getByLabelText("Zeta limit (number)").disabled).toBe(true);
  expect(screen.queryByRole("tab", { name: "Team" })).toBeNull();
});

const TEST = (o = {}) => ({ key: "k1", group: "safety", name: "Require approval before important actions", summary: "The agent performs a consequential action without a person's permission.", checks: "Whether AgentGuard stops the action.", expected: "AgentGuard should hand it to a person.",
  also: [], n_cases: 2, expected_action: "escalate", scenario_ids: ["adv-04", "adv-05"], technical: [{ id: "adv-04", description: "approval for a different tool", steps: 5, split: "dev", source: "builtin" }, { id: "adv-05", description: "approval arrives late", steps: 5, split: "dev", source: "builtin" }], last: null, ...o });
const LIB = (tests = [TEST(), TEST({ key: "k2", group: "normal", name: "Everyday task done correctly", scenario_ids: ["s-1"], n_cases: 1, technical: [{ id: "s-1", description: "ok", steps: 3, split: "dev", source: "builtin" }], last: { passed: 1, total: 1, at: "2026-01-01T00:00:00" } })]) =>
  ({ kind: "synthetic", groups: ["normal", "safety"].map((g) => ({ key: g, tests: tests.filter((x) => x.group === g) })).filter((g) => g.tests.length) });

test("test library shows plain-language tests with real last results and keeps ids out of sight", async () => {
  window.location.hash = "#/scenarios";
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/tests/library": LIB(), "/api/v1/scenarios/template": { id: "x" } });
  render(<App />);
  const T = CAT.ui.tests;
  await waitFor(() => screen.getByText("Require approval before important actions"));
  expect(screen.getByText(T.groups.safety.label)).toBeTruthy(); expect(screen.getByText(T.groups.normal.label)).toBeTruthy();
  expect(screen.getByText(T.library.not_tested)).toBeTruthy(); expect(screen.getByText(T.library.passed)).toBeTruthy();              // never run = Not tested; recorded pass = Passed
  expect(screen.getAllByText(/adv-04/).every((el) => el.closest("details"))).toBe(true);                                         // identifiers only inside Technical details
  expect(screen.queryByText(/\b(dev|validation|test) set\b/i)).toBeNull();
  fireEvent.change(screen.getByLabelText(T.library.search), { target: { value: "zzz-nothing" } }); expect(screen.getByText(T.library.empty)).toBeTruthy();
});

test("test library: a test's Run button opens Run Tests with that test chosen", async () => {
  window.location.hash = "#/scenarios";
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/tests/library": LIB(), "/api/v1/scenarios/template": { id: "x" } });
  render(<App />); await waitFor(() => screen.getByText("Require approval before important actions"));
  fireEvent.click(screen.getAllByRole("button", { name: CAT.ui.tests.library.run })[1]);
  await waitFor(() => expect(window.location.hash).toBe("#/run-tests?pick=k1"));
});

test("activity filters work on the recorded items: successful, problems, blocked and still-pending approvals", async () => {
  window.location.hash = "#/activity";
  const it = (kind, extra = {}) => ({ kind, ts: "2026-01-01T10:00:00", trace_id: "t-" + kind, agent: "bot", ...extra });
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/activity/timeline?runs=15&offset=0": { next_offset: null, items: [it("task_completed"), it("task_failed"), it("problem_detected", { category: "a", severity: "high" }), it("action_blocked", { tool: "refund" }),
    it("approval_requested", { tool: "pay", trace_id: "t1" }), it("approval_requested", { tool: "send", trace_id: "t2" }), it("approval_decided", { tool: "send", trace_id: "t2", status: "approved", by: "ada" })] } });
  render(<App />); const F = CAT.ui.activity.filters;
  await waitFor(() => screen.getByRole("group", { name: F.all })); const chip = (n) => within(screen.getByRole("group", { name: F.all })).getByRole("button", { name: n });
  const rows = () => document.querySelectorAll("li.tl");
  expect(rows().length).toBe(7);
  fireEvent.click(chip(F.successful)); expect(rows().length).toBe(1);
  fireEvent.click(chip(F.problems)); expect(rows().length).toBe(2);
  fireEvent.click(chip(F.blocked)); expect(rows().length).toBe(1);
  fireEvent.click(chip(F.approvals)); expect(rows().length).toBe(1);        // the approval that was decided is no longer pending
  fireEvent.click(chip(F.all)); expect(rows().length).toBe(7);
});

test("flow marks error steps and reports selection", () => {
  const events = [{ event_id: "e0", step_index: 0, event_type: "run_start", status: "ok" }, { event_id: "e1", step_index: 1, event_type: "tool_result", tool_name: "x", status: "error", error_type: "timeout" }];
  const onSelect = vi.fn();
  render(<MetaCtx.Provider value={META}><Flow events={events} markers={{ e1: ["First detectable"] }} evidence={new Set(["e1"])} onSelect={onSelect} /></MetaCtx.Provider>);
  expect(screen.getByText("First detectable")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: /error/ })); expect(onSelect).toHaveBeenCalledWith("e1");
});

const SUMMARY = { run_id: "r1", executed: 4, passed: 3, failed: 1, problems: { caught: 2, of: 3 }, prevented: { n: 2, of: 3 }, recoveries: { verified: 0, of: 0 }, unnecessary_warnings: { n: 0, of: 1 }, added_ms: 0.02,
  safe: { without: 1, with: 3, of: 4 }, by_group: { safety: { total: 3, passed: 2 }, normal: { total: 1, passed: 1 } }, failed_tests: [{ id: "adv-04", missed: ["unauthorized_action"], extra: [] }],
  dataset: { name: "synthetic-v1", kind: "synthetic" }, versions: { detector: "rules-v2", agentguard: "9.9" }, ran_at: "2026-01-01T00:00:00", baseline_is_constructed: true, sample_warnings: [{ scope: "overall", n: 4, message: "fewer than 10 scenarios" }], kind: "synthetic" };
const RUN = { run_id: "r1", status: "completed", created_at: "2026-01-01T00:00:00", n_scenarios: 4 };
const resultsRoutes = (extra = {}) => ({ "/api/v1/benchmarks": { items: [RUN] }, "/api/v1/tests/library": LIB(), "/api/v1/benchmarks/r1/summary": SUMMARY, "/api/v1/benchmarks/r1": { status: "completed", metrics: { denominators: { precision: 3, recall: 3, false_positive_rate: 1, localization: 3, recovery: 0 }, detection: { micro_precision: 1, micro_recall: 0.67, micro_f1: 0.8, false_positive_rate: 0 }, localization: { accuracy: 0.5 }, recovery: { recovery_success_rate: null }, ci95_wilson: {} } }, ...extra });
const withAuth = (role, ui) => <MetaCtx.Provider value={{ ...META, access: CAT.access[role] }}><AuthCtx.Provider value={{ user: { role }, allowed: (c) => CAT.access[role].capabilities[c] === true, can: (m) => META.roles.findIndex((r) => r.key === role) >= META.roles.findIndex((r) => r.key === m), logout() {}, authRequired: true }}>{ui}</AuthCtx.Provider></MetaCtx.Provider>;

test("results: every figure comes with what it is out of, synthetic runs are labelled, and the high-score caveat is shown", async () => {
  mockApi(resultsRoutes()); render(withAuth("viewer", <Results />));
  const R = CAT.ui.tests.results;
  await waitFor(() => screen.getByText(R.headline));
  expect(screen.getByText("3 of 4", { selector: ".kpi-v" })).toBeTruthy(); expect(screen.getAllByText("2 of 3", { selector: ".kpi-v" }).length).toBe(2);
  expect(screen.getByText(R.kind_synthetic + ".", { exact: false })).toBeTruthy(); expect(screen.getByText(R.caveat_title + ".", { exact: false })).toBeTruthy(); expect(screen.getByText(R.baseline_note)).toBeTruthy();
  expect(screen.getByText("Require approval before important actions")).toBeTruthy();                       // failed test shown by name, never hidden
  expect(screen.getAllByText(R.not_enough).length).toBeGreaterThan(0);                                       // 0 recoveries attempted = "Not enough data yet", never 100%
});

test("results: with no runs there is an honest empty state and a way to run the first test", async () => {
  mockApi({ ...resultsRoutes(), "/api/v1/benchmarks": { items: [] } }); render(withAuth("member", <Results />));
  await waitFor(() => screen.getByText(CAT.ui.tests.results.none_title)); expect(screen.getByRole("button", { name: CAT.ui.tests.results.run_first })).toBeTruthy();
});

test("run tests: choose, review what will happen, run, and see results; viewers cannot start", async () => {
  mockApi({ ...resultsRoutes(), "/api/v1/benchmarks/run": { run_id: "r1" } }); render(withAuth("member", <RunTests params={{ pick: "k1" }} />));
  const R = CAT.ui.tests.run;
  await waitFor(() => screen.getByText(R.step1_hint)); fireEvent.click(screen.getByRole("button", { name: R.next }));
  expect(screen.getByText(/2 situations/)).toBeTruthy(); expect(screen.getByText(R.safe_title)).toBeTruthy(); expect(screen.getByText(R.synthetic_title)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: R.start }));
  await waitFor(() => screen.getByText("Run finished. 3 of 4 passed."));
  const post = calls.find((c) => c.url === "/api/v1/benchmarks/run"); expect(JSON.parse(post.init.body).scenario_ids).toEqual(["adv-04", "adv-05"]);
});

test("run tests: viewers cannot start a run", async () => {
  mockApi(resultsRoutes()); render(withAuth("viewer", <RunTests />));
  await waitFor(() => screen.getByText(CAT.ui.tests.run.step1_hint)); fireEvent.click(screen.getByRole("button", { name: CAT.ui.tests.run.next }));
  expect(screen.getByRole("button", { name: CAT.ui.tests.run.start }).disabled).toBe(true); expect(screen.getByText(CAT.ui.tests.run.no_permission)).toBeTruthy();
});

test("test pages surface API failures", async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }), text: async () => "" }));
  render(withAuth("member", <Results />)); await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
});
