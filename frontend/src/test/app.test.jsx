import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MetaCtx } from "../api";
import App from "../App";
import Bench from "../pages/Bench";
import Flow from "../components/Flow";

const META = { categories: { unauthorized_action: { label: "Action without approval" }, a: { label: "Category A" } }, metrics: { recall: { label: "Recall", plain: "caught" }, precision: { plain: "right" } }, actions: {}, severities: [] };
const OV_EMPTY = { live: { total_runs: 0, runs_with_findings: 0, clean_runs: 0, failure_rate: null, by_category: {}, by_severity: {}, recent_incidents: [] }, benchmark: null };
const OV_FULL = { live: { total_runs: 4, runs_with_findings: 1, clean_runs: 3, failure_rate: 0.25, by_category: { unauthorized_action: 1 }, by_severity: { critical: 1 },
  recent_incidents: [{ trace_id: "t1", agent_name: "a", created_at: "2026-01-01T00:00:00", n_events: 3, status: "flagged", max_severity: "critical", categories: ["unauthorized_action"], headline: "Refund ran without approval" }] }, benchmark: null };
const M = { n_scenarios: 2, detection: { micro_precision: 1, micro_recall: 0.5, micro_f1: 0.66, false_positive_rate: 0 }, per_category: { a: { precision: 1, recall: 0.5, f1: 0.6, support: 2 } },
  per_scenario_category: { success: { n: 1, baseline_safe: 1, protected_safe: 1, baseline_success: 1, protected_success: 1 } }, localization: { accuracy: 1 },
  outcomes: { baseline_task_success: 0.3, protected_task_success: 0.4, baseline_safe_outcome: 0.3, protected_safe_outcome: 0.9, safe_outcome_improvement_ci95: [0.5, 0.7] },
  recovery: { recovery_success_rate: 0.5, n_attempted: 2 }, unnecessary_intervention_rate: 0, latency_ms: { mean_added: 0.02 } };

function mockApi(routes) {
  globalThis.fetch = vi.fn(async (url) => { const k = String(url); const hit = routes[k]; return { ok: hit !== undefined, status: hit !== undefined ? 200 : 404, json: async () => hit ?? { error: { message: "nope" } }, text: async () => "" }; });
}
beforeEach(() => { window.location.hash = ""; });

test("empty overview guides a new user to load demo data", async () => {
  mockApi({ "/api/v1/meta": META, "/health": { status: "ok" }, "/api/v1/metrics/overview": OV_EMPTY, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Load demo data" })).toBeTruthy());
  expect(screen.getByText("API connected")).toBeTruthy();
});

test("overview shows human labels and clickable incidents, not raw field names", async () => {
  mockApi({ "/api/v1/meta": META, "/health": { status: "ok" }, "/api/v1/metrics/overview": OV_FULL, "/api/v1/metrics/trends": { items: [] } });
  render(<App />);
  await waitFor(() => expect(screen.getByText("Refund ran without approval")).toBeTruthy());
  expect(screen.getAllByText(/Action without approval/).length).toBeGreaterThan(0);
  expect(screen.queryByText("unauthorized_action")).toBeNull();
  expect(screen.getByText(/Investigate/).closest("a").getAttribute("href")).toBe("#/traces/t1");
});

test("backend down shows an actionable message", async () => {
  globalThis.fetch = vi.fn(async () => { throw new Error("network"); });
  render(<App />);
  await waitFor(() => expect(screen.getByText(/Can’t reach the backend/)).toBeTruthy());
});

test("flow marks error steps and reports selection", () => {
  const events = [{ event_id: "e0", step_index: 0, event_type: "run_start", status: "ok" }, { event_id: "e1", step_index: 1, event_type: "tool_result", tool_name: "x", status: "error", error_type: "timeout" }];
  const onSelect = vi.fn();
  render(<Flow events={events} markers={{ e1: ["First detectable"] }} evidence={new Set(["e1"])} onSelect={onSelect} />);
  expect(screen.getByText("First detectable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /error/ }));
  expect(onSelect).toHaveBeenCalledWith("e1");
});

test("benchmark lab: run, verdict, mistakes in plain words, and error state", async () => {
  const routes = { "/api/v1/meta": META, "/api/v1/scenarios": { items: [{ id: "s1", category: "a" }] }, "/api/v1/benchmarks": { items: [] }, "/api/v1/benchmarks/run": { run_id: "r1" },
    "/api/v1/benchmarks/r1": { status: "completed", metrics: M }, "/api/v1/benchmarks/r1/results": { results: [] },
    "/api/v1/benchmarks/r1/results?only=mistakes": { results: [{ id: "s1", true: ["a"], pred: [] }] } };
  mockApi(routes);
  render(<MetaCtx.Provider value={META}><Bench /></MetaCtx.Provider>);
  await waitFor(() => expect(screen.getByRole("button", { name: /Run all scenarios/ }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /Run all scenarios/ }));
  await waitFor(() => expect(screen.getByText(/Safe outcomes rose from/)).toBeTruthy());
  expect(screen.getByText("Missed: Category A")).toBeTruthy();
  expect(screen.getByText(/synthetic, simulated/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
});

test("benchmark lab surfaces API failures", async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }), text: async () => "" }));
  render(<MetaCtx.Provider value={META}><Bench /></MetaCtx.Provider>);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
});
