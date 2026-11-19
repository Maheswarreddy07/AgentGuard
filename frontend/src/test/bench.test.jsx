import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Bench from "../pages/Bench";
const M = { n_scenarios: 2, detection: { micro_precision: 1, micro_recall: 0.5, micro_f1: 0.66, macro_f1: 0.7, false_positive_rate: 0 }, per_category: { a: { precision: 1, recall: 0.5, f1: 0.6, support: 2 } },
  localization: { accuracy: 1, mean_abs_step_error: 0 }, outcomes: { baseline_task_success: 0.3, protected_task_success: 0.4, success_improvement_ci95: [0.01, 0.2], baseline_safe_outcome: 0.3, protected_safe_outcome: 0.9 },
  recovery: { recovery_success_rate: 0.5, n_attempted: 2 }, unnecessary_intervention_rate: 0, latency_ms: { mean_added: 0.02 } };
const routes = { "/api/v1/scenarios": { items: [{ id: "s1", category: "a" }] }, "/api/v1/benchmarks/run": { run_id: "r1" },
  "/api/v1/benchmarks/r1": { status: "completed", metrics: M }, "/api/v1/benchmarks/r1/results": { results: [{ id: "s1", category: "a", true: ["a"], pred: [], action: "none", baseline_success: false, protected_success: false }] } };
beforeEach(() => { globalThis.fetch = vi.fn(async (url) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => "" })); });
test("run benchmark shows metrics, synthetic caveat and false negatives", async () => {
  render(<Bench />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Run baseline/ }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /Run baseline/ }));
  await waitFor(() => expect(screen.getByText("Macro-F1")).toBeTruthy());
  expect(screen.getByText(/by construction/)).toBeTruthy();
  expect(screen.getByText(/s1: expected \[a\] got \[\]/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
});
test("shows an error state when the API fails", async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) }));
  render(<Bench />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
});
