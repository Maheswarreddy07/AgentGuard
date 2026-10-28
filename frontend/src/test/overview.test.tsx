import { render, screen } from "@testing-library/react";
import { OverviewView } from "../pages/Overview";
const empty = { live: { total_runs: 0, runs_with_findings: 0, failure_rate: null, by_category: {} }, benchmark: null };
test("shows empty states instead of fake numbers", () => {
  render(<OverviewView d={empty} />);
  expect(screen.getByText(/No traces yet/)).toBeTruthy(); expect(screen.getByText(/No benchmark has been run/)).toBeTruthy();
});
test("labels benchmark data as synthetic", () => {
  render(<OverviewView d={{ ...empty, benchmark: { run_id: "x", detection: { micro_precision: 0.9, micro_recall: 0.8 }, recovery: { recovery_success_rate: 0.5 }, latency_ms: { mean_added: 0.01 } } }} />);
  expect(screen.getByText("synthetic · simulated")).toBeTruthy(); expect(screen.getByText("90.0%")).toBeTruthy();
});
