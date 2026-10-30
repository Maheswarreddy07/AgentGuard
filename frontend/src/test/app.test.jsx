import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuthCtx, MetaCtx, setToken } from "../api";
import App from "../App";
import Bench from "../pages/Bench";
import Flow from "../components/Flow";

const META = { categories: { unauthorized_action: { label: "Action without approval", why: "ran without approval" }, a: { label: "Category A" } }, metrics: { recall: { label: "Recall", plain: "caught" }, precision: { plain: "right" } },
  actions: { escalate: { label: "Hand to a human", icon: "🙋", plain: "A person must take over." }, none: { label: "No action needed", icon: "✓", plain: "" } }, severities: ["low", "medium", "high", "critical"],
  severity_colors: { critical: "#ff0000", high: "#ff9900", medium: "#ffee00", low: "#0000ff" },
  roles: [{ key: "viewer", label: "Viewer", plain: "look only" }, { key: "member", label: "Member", plain: "can run things" }, { key: "admin", label: "Admin", plain: "everything" }] };
const OPEN = { auth_required: false, setup_required: false, session_hours: 12, min_password_length: 10 };
const ADMIN = { kind: "user", id: 1, email: "ada@x.io", name: "Ada", role: "admin" };
const OV = { live: { total_runs: 4, runs_with_findings: 1, clean_runs: 3, failure_rate: 0.25, by_category: { unauthorized_action: 1 }, category_stats: { unauthorized_action: { count: 1, max_severity: "critical" } }, by_severity: { critical: 1 },
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
const base = { "/api/v1/meta": META, "/health": { status: "ok", database: "ok", version: "9.9" } };
beforeEach(() => { localStorage.clear(); window.location.hash = ""; });

test("first run: creates the admin account and signs in", async () => {
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
  setToken("old");
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/me": ADMIN, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => screen.getByText("Refund ran without approval"));
  window.dispatchEvent(new Event("ag-unauth"));
  await waitFor(() => expect(screen.getByText(/session ended/)).toBeTruthy());
  expect(localStorage.getItem("agentguard.token")).toBeNull();
});

test("local mode (sign-in off) goes straight to the app and says so", async () => {
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => expect(screen.getByText("Refund ran without approval")).toBeTruthy());
  expect(screen.getByText(/sign-in is off/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

test("overview uses human labels from the API and links incidents", async () => {
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/metrics/overview": OV, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => screen.getByText("Refund ran without approval"));
  expect(screen.getAllByText(/Action without approval/).length).toBeGreaterThan(0); expect(screen.queryByText("unauthorized_action")).toBeNull();
  expect(screen.getByText(/Investigate/).closest("a").getAttribute("href")).toBe("#/traces/t1");
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

test("non-admins see settings read-only and no Team tab", async () => {
  setToken("t"); window.location.hash = "#/settings?tab=safety";
  mockApi({ ...base, "/api/v1/auth/status": { ...OPEN, auth_required: true }, "/api/v1/auth/me": { ...ADMIN, role: "viewer" }, "/api/v1/settings": SETTINGS });
  render(<App />);
  await waitFor(() => screen.getByText("Zeta limit"));
  expect(screen.getByText(/only admins can change/)).toBeTruthy(); expect(screen.getByLabelText("Zeta limit (number)").disabled).toBe(true);
  expect(screen.queryByRole("tab", { name: "Team" })).toBeNull();
});

test("scenarios page shows visual cards and opens details", async () => {
  window.location.hash = "#/scenarios";
  const item = (id, cats) => ({ id, category: "contradiction", description: "[SYNTHETIC] desc " + id, labels: { failure_categories: cats, earliest_detectable_step: 1, expected_action: cats.length ? "escalate" : "none" }, n_events: 3, preview: [{ t: "run_start", s: "ok" }, { t: "tool_result", s: "bad" }] });
  mockApi({ ...base, "/api/v1/auth/status": OPEN, "/api/v1/scenarios": { items: [item("s-bad", ["unauthorized_action"]), item("s-ok", [])] }, "/api/v1/scenarios/template": { id: "x" },
    "/api/v1/scenarios/s-bad": { ...item("s-bad", ["unauthorized_action"]), sim: { transient_fail_count: 0, corrected_args_valid: true, evidence_available: true }, events: [] } });
  render(<App />);
  await waitFor(() => screen.getByLabelText("Open s-bad"));
  expect(screen.getAllByText(/should stay quiet/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByLabelText("Open s-bad"));
  const dlg = await screen.findByRole("dialog"); await waitFor(() => within(dlg).getByText("What AgentGuard should find"));
  expect(within(dlg).getByText("Action without approval")).toBeTruthy(); expect(within(dlg).getByText(/Hand to a human/)).toBeTruthy();
});

test("flow marks error steps and reports selection", () => {
  const events = [{ event_id: "e0", step_index: 0, event_type: "run_start", status: "ok" }, { event_id: "e1", step_index: 1, event_type: "tool_result", tool_name: "x", status: "error", error_type: "timeout" }];
  const onSelect = vi.fn();
  render(<Flow events={events} markers={{ e1: ["First detectable"] }} evidence={new Set(["e1"])} onSelect={onSelect} />);
  expect(screen.getByText("First detectable")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: /error/ })); expect(onSelect).toHaveBeenCalledWith("e1");
});

const M = { n_scenarios: 2, detection: { micro_precision: 1, micro_recall: 0.5, micro_f1: 0.66, false_positive_rate: 0 }, per_category: { a: { precision: 1, recall: 0.5, f1: 0.6, support: 2 } },
  per_scenario_category: { success: { n: 1, baseline_safe: 1, protected_safe: 1 } }, localization: { accuracy: 1 },
  outcomes: { baseline_task_success: 0.3, protected_task_success: 0.4, baseline_safe_outcome: 0.3, protected_safe_outcome: 0.9, safe_outcome_improvement_ci95: [0.5, 0.7] }, recovery: { recovery_success_rate: 0.5, n_attempted: 2 }, latency_ms: { mean_added: 0.02 } };
function benchRoutes() { return { "/api/v1/scenarios": { items: [{ id: "s1", category: "a" }] }, "/api/v1/benchmarks": { items: [] }, "/api/v1/benchmarks/run": { run_id: "r1" }, "/api/v1/benchmarks/r1": { status: "completed", metrics: M },
  "/api/v1/benchmarks/r1/results": { results: [] }, "/api/v1/benchmarks/r1/results?only=mistakes": { results: [{ id: "s1", true: ["a"], pred: [] }] } }; }
const withAuth = (role, ui) => <MetaCtx.Provider value={META}><AuthCtx.Provider value={{ user: { role }, can: (m) => META.roles.findIndex((r) => r.key === role) >= META.roles.findIndex((r) => r.key === m), logout() {}, authRequired: true }}>{ui}</AuthCtx.Provider></MetaCtx.Provider>;

test("benchmark lab: members can run it and read mistakes in plain words", async () => {
  mockApi(benchRoutes()); render(withAuth("member", <Bench />));
  await waitFor(() => expect(screen.getByRole("button", { name: /Run all scenarios/ }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /Run all scenarios/ }));
  await waitFor(() => expect(screen.getByText(/Safe outcomes rose from/)).toBeTruthy());
  expect(screen.getByText("Missed: Category A")).toBeTruthy(); expect(screen.getByText(/synthetic, simulated/)).toBeTruthy();
});

test("benchmark lab: viewers cannot start runs", async () => {
  mockApi(benchRoutes()); render(withAuth("viewer", <Bench />));
  await waitFor(() => screen.getByRole("button", { name: /Run all scenarios/ }));
  expect(screen.getByRole("button", { name: /Run all scenarios/ }).disabled).toBe(true); expect(screen.getByText(/only members and admins can start/)).toBeTruthy();
});

test("benchmark lab surfaces API failures", async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }), text: async () => "" }));
  render(withAuth("member", <Bench />)); await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
});
