import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { setToken } from "../api";
import App from "../App";

import CAT from "./catalog.json";
const META = { access: CAT.access.admin, ui: CAT.ui, categories: { workflow_invariant_violation: { label: "Steps out of order" }, repeated_failures: { label: "Stuck in a retry loop" } }, metrics: {}, actions: { stop: { label: "Stop the run", icon: "⛔", plain: "" }, escalate: { label: "Hand to a human", icon: "🙋", plain: "" } },
  severities: ["info", "low", "medium", "high", "critical"], severity_colors: { critical: "#f00", high: "#f90", medium: "#fe0", low: "#00f", info: "#888" },
  roles: [{ key: "viewer", label: "Viewer", plain: "" }, { key: "member", label: "Member", plain: "" }, { key: "admin", label: "Admin", plain: "" }],
  modes: { observe: "Only watch.", warn: "Warn only.", enforce: "Really stop." }, policy_actions: { BLOCK: "Stop it", REQUIRE_APPROVAL: "A human must approve", WARN: "Warn" } };
const OPEN = { ui: { login: CAT.ui.login, shell: CAT.ui.shell }, auth_required: true, setup_required: false, session_hours: 12, min_password_length: 10 };
const ME = { kind: "user", id: 1, email: "ada@x.io", name: "Ada", role: "admin" };
const SPECS = { argument_compare: { label: "An argument has a certain value", help: "Matches when an input meets a rule.", fields: [{ name: "field", label: "Argument name", kind: "text" }, { name: "op", label: "Operator", kind: "select", options: ["gt", "lt"] }, { name: "value", label: "Value", kind: "value" }] },
  tool_call_count_above: { label: "Too many tool calls", help: "Matches when a call limit is exceeded.", fields: [{ name: "limit", label: "Limit", kind: "number" }] } };
const TPL = { items: [], categories: ["custom", "approval"], actions: {}, condition_types: ["tool_call_count_above", "argument_compare"], condition_specs: SPECS, operators: [] };
const POLICY = { id: 7, name: "limit_refunds", description: "Stop big refunds", category: "approval", enabled: true, version: 2, n_versions: 2, evaluations: 10, matches: 3, created_by: "ada@x.io", created_at: "2026-01-01T00:00:00",
  definition: { scope: { agents: ["*"], tools: ["issue_refund"] }, condition: { type: "argument_compare", field: "amount", op: "gt", value: 100 }, action: "REQUIRE_APPROVAL", severity: "high", message: "" } };

let calls;
function mockApi(routes) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init }); const key = Object.keys(routes).find((k) => k === url || (k.endsWith("*") && String(url).startsWith(k.slice(0, -1))));
    const hit = key === undefined ? undefined : typeof routes[key] === "function" ? routes[key](url, init) : routes[key];
    return { ok: hit !== undefined, status: hit !== undefined ? 200 : 404, json: async () => hit ?? { error: { message: "nope" } }, text: async () => "" };
  });
}
const base = { "/api/v1/meta": META, "/health": { status: "ok", version: "1" }, "/api/v1/auth/status": OPEN, "/api/v1/auth/me": ME, "/api/v1/approvals?status=pending&limit=1": { pending: 1, items: [], total: 1 } };
beforeEach(() => { localStorage.clear(); setToken("t"); });

test("policy center describes rules in plain words and builds the form from the server's specs", async () => {
  window.location.hash = "#/policies";
  mockApi({ ...base, "/api/v1/policies": { items: [POLICY] }, "/api/v1/policies/templates": TPL, "/api/v1/policies": (u, i) => (i.method === "POST" ? { id: 9 } : { items: [POLICY] }) });
  render(<App />);
  await waitFor(() => screen.getByText("limit_refunds"));
  expect(screen.getByText(/An argument has a certain value — Argument name: amount · Operator: gt · Value: 100/)).toBeTruthy();   // text comes from the API's spec, not the UI
  expect(screen.getByText("10 checks · 3 triggered")).toBeTruthy(); expect(screen.getByText("Really stop.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /New policy/ }));
  const dlg = await screen.findByRole("dialog");
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "cap_calls" } });
  fireEvent.change(within(dlg).getByLabelText("Condition"), { target: { value: "tool_call_count_above" } });
  fireEvent.change(await within(dlg).findByLabelText("Limit"), { target: { value: "25" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create policy" }));
  await waitFor(() => expect(calls.some((c) => c.init.method === "POST" && c.url === "/api/v1/policies")).toBe(true));
  const body = JSON.parse(calls.find((c) => c.init.method === "POST").init.body);
  expect(body.name).toBe("cap_calls"); expect(body.definition.condition).toEqual({ type: "tool_call_count_above", limit: 25 });   // number, not "25"
  expect(body.definition.scope).toEqual({ agents: ["*"], tools: ["*"] });
});

test("only admins can switch policies on or off", async () => {
  window.location.hash = "#/policies";
  mockApi({ ...base, "/api/v1/auth/me": { ...ME, role: "viewer" }, "/api/v1/meta": { ...META, access: CAT.access.viewer }, "/api/v1/policies": { items: [POLICY] }, "/api/v1/policies/templates": TPL });
  render(<App />);
  await waitFor(() => screen.getByText("limit_refunds"));
  expect(screen.getByRole("switch", { name: "Enable limit_refunds" }).disabled).toBe(true); expect(screen.getByRole("button", { name: /New policy/ }).disabled).toBe(true);
});

const APPROVAL = { id: 5, trace_id: "run-1", agent_name: "support", tool_name: "issue_refund", arguments: { amount: 250 }, reason: "[big_refund] amount = 250 meets the rule", policy_name: "big_refund", evidence_steps: [1], status: "pending", consumed: false,
  created_at: "2026-01-01T00:00:00", expires_at: "2026-01-01T01:00:00", decided_by: null, decision_note: null, decided_at: null };

test("approvals: rejecting needs a reason; approving is one click and says it is single-use", async () => {
  window.location.hash = "#/approvals";
  mockApi({ ...base, "/api/v1/approvals?limit=50&status=pending": { total: 1, pending: 1, items: [APPROVAL] }, "/api/v1/approvals/5": { ...APPROVAL, evidence: [{ event_id: "e1", step_index: 1, event_type: "tool_call", tool_name: "get_order", status: "ok" }] },
    "/api/v1/approvals/5/decision": (u, i) => ({ ...APPROVAL, status: JSON.parse(i.body).decision === "approve" ? "approved" : "rejected" }) });
  render(<App />);
  await waitFor(() => screen.getByText(/amount = 250 meets the rule/));
  expect(screen.getByText(/step 1: tool call · get_order/)).toBeTruthy();
  const reject = screen.getByRole("button", { name: "Reject" }); expect(reject.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Note \(required/), { target: { value: "customer under review" } }); expect(reject.disabled).toBe(false);
  fireEvent.click(reject);
  await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/approvals/5/decision")).toBe(true));
  expect(JSON.parse(calls.find((c) => c.url === "/api/v1/approvals/5/decision").init.body)).toEqual({ decision: "reject", note: "customer under review" });
});

test("risk monitor explains every score and states how reliable the warnings were", async () => {
  window.location.hash = "#/risk";
  mockApi({ ...base, "/api/v1/risk/metrics": { n_predictions: 4, n_resolved: 3, n_pending: 1, precision: 0.667, recall: 0.5, n_failures: 4, avg_lead_steps: 1.5, warned_before_failure: 0.5, false_intervention_rate: 0.33, n_high_resolved: 3, definitions: { precision: "right ones", recall: "caught ones", lead: "head start", false_intervention: "needless" } },
    "/api/v1/risk/monitor": { threshold: 50, items: [{ trace_id: "run-9", agent_name: "support", task: "Refund", outcome: "running", risk_score: 80, mode: "enforce", blocked_actions: 0, updated_at: "2026-01-01T00:00:00", prediction: { level: "critical", predicted_failure: "repeated_failures", confidence: "high", evidence: ["the last 3 tool results were all errors (+60)"], recommended_action: "stop", outcome: "pending", step_index: 5 } }] },
    "/api/v1/risk/predictions?limit=30": { total: 1, items: [{ id: 1, trace_id: "run-9", step_index: 5, score: 80, level: "critical", predicted_failure: "repeated_failures", confidence: "high", evidence: [], signals: [{ name: "failure_streak", points: 60, predicts: "repeated_failures", detail: "the last 3 tool results were all errors" }], recommended_action: "stop", outcome: "occurred", lead_steps: 1 }] } });
  render(<App />);
  const R = CAT.ui.risk, C = CAT.ui.common;
  await waitFor(() => screen.getByText("Stuck in a retry loop", { selector: "b" }));
  expect(screen.getByText(new RegExp(R.suggested))).toBeTruthy(); expect(screen.getByText(/Stop the run/)).toBeTruthy(); expect(screen.queryByText("run-9")).toBeNull();     // simple by default: no ids or scores
  fireEvent.click(await screen.findByRole("button", { name: R.reliability_show })); expect(await screen.findByText("67%")).toBeTruthy(); expect(screen.getByText(/rule-based score/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: CAT.ui.strings.technical_details.title })); expect(await screen.findByText(/run-9/)).toBeTruthy();
  fireEvent.click(await screen.findByText(new RegExp("came true"), { selector: "td" })); expect(await screen.findByText(R.built)).toBeTruthy(); expect(screen.getAllByText(/the last 3 tool results/).length).toBeGreaterThan(0);
});

test("navigation shows the number of approvals waiting", async () => {
  window.location.hash = "#/overview";
  mockApi({ ...base, "/api/v1/metrics/overview": { agents: { registered: 0, connected: 0 }, suggestions: [{ key: "connect_first_agent", path: "/integrations" }], live: { total_runs: 0, runs_with_findings: 0, clean_runs: 0, failure_rate: null, by_category: {}, category_stats: {}, by_severity: {}, recent_incidents: [] }, benchmark: null } });
  render(<App />);
  await waitFor(() => expect(screen.getAllByLabelText("1 waiting").length).toBeGreaterThan(0));
});
