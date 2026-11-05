import { render, screen, fireEvent } from "@testing-library/react";
import { MetaCtx } from "../hooks/context";
import AgentCard from "../components/AgentCard";
import AgentTable from "../components/AgentTable";
import ActivityTimeline from "../components/ActivityTimeline";
import AppSidebar from "../components/AppSidebar";
import ApprovalCard from "../components/ApprovalCard";
import BenchmarkComparison from "../components/BenchmarkComparison";
import EmptyState from "../components/EmptyState";
import IntegrationWizard from "../components/IntegrationWizard";
import LoadingState from "../components/LoadingState";
import PageHeader from "../components/PageHeader";
import ProblemCard from "../components/ProblemCard";
import ProblemDetails from "../components/ProblemDetails";
import SafetyRuleCard from "../components/SafetyRuleCard";
import ScenarioCard from "../components/ScenarioCard";
import TechnicalDetails from "../components/TechnicalDetails";
import { applyTheme } from "../ui";

const META = { categories: { workflow_invariant_violation: { label: "Steps out of order" } }, actions: { escalate: { icon: "🙋", label: "Hand to a human" } }, severities: ["low", "high"], severity_colors: { high: "#f90", low: "#00f" } };
beforeAll(() => applyTheme(META));

test("AppSidebar shows grouped navigation, marks the current page and shows a waiting badge", () => {
  const onNavigate = vi.fn();
  render(<AppSidebar groups={[{ label: "Protect", items: [{ path: "/approvals", icon: "✋", label: "Approvals" }, { path: "/policies", icon: "🛡", label: "Safety Rules" }] }]} active="/approvals" onNavigate={onNavigate} user={{ name: "Ada", email: "a@x.io" }} roleName="Admin" authRequired onSignOut={vi.fn()} apiStatus="up" badges={{ "/approvals": 3 }} />);
  expect(screen.getByText("Protect")).toBeTruthy(); expect(screen.getByRole("button", { name: /Approvals/ }).getAttribute("aria-current")).toBe("page"); expect(screen.getByLabelText("3 waiting")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Safety Rules/ })); expect(onNavigate).toHaveBeenCalledWith("/policies"); expect(screen.getByText("API connected")).toBeTruthy();
});

test("PageHeader, EmptyState, LoadingState and TechnicalDetails", () => {
  const retry = vi.fn();
  render(<><PageHeader title="Agents" subtitle="Plain words" actions={<button>Add</button>} /><EmptyState title="Nothing here" icon="🗂" action={<button>Do it</button>} /><LoadingState error="boom" onRetry={retry} /><TechnicalDetails data={{ a: 1 }} /></>);
  expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy(); expect(screen.getByText("Plain words")).toBeTruthy(); expect(screen.getByText("Nothing here")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(retry).toHaveBeenCalled();
  const d = screen.getByText("Technical details").closest("details"); expect(d.open).toBe(false);          // raw data stays tucked away by default
});

const AGENTS = [{ id: 1, name: "support", description: "Handles refunds", environment: "prod", runs: 10, flagged_runs: 6, blocked_actions: 2, avg_risk: 40, last_seen_at: "2026-01-01T00:00:00" }, { id: 2, name: "idle", runs: 0, flagged_runs: 0, blocked_actions: 0, avg_risk: null, environment: "dev", last_seen_at: null }];
test("AgentCard and AgentTable give a plain-language health verdict and open the agent", () => {
  const open = vi.fn();
  render(<><AgentCard agent={AGENTS[0]} onOpen={open} /><AgentTable agents={AGENTS} onOpen={open} /></>);
  expect(screen.getAllByText("Needs attention").length).toBe(2); expect(screen.getByText("No runs yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open runs of support" })); expect(open).toHaveBeenCalledWith(AGENTS[0]);
});

const PROBLEM = { id: "abc", trace_id: "run-1", label: "Action without approval", severity: "high", description: "Refund ran without approval.", source: "rule", detected_at: "2026-01-01T00:00:00", why: "Money moved with no human check.", fix: "Require approval.", confidence: 1, evidence_event_ids: ["e2"] };
test("ProblemCard summarises and ProblemDetails explains why it matters, with evidence behind a toggle", () => {
  const open = vi.fn(), pick = vi.fn();
  render(<><ProblemCard problem={PROBLEM} onOpen={open} /><ProblemDetails problem={PROBLEM} evidenceEvents={[{ event_id: "e2" }]} onSelectEvent={pick} stepOf={() => 4} /></>);
  fireEvent.click(screen.getByRole("button", { name: "See details" })); expect(open).toHaveBeenCalledWith(PROBLEM);
  expect(screen.getByText(/Money moved with no human check/)).toBeTruthy(); expect(screen.getByText(/Require approval/)).toBeTruthy(); expect(screen.getAllByText("proven by rule").length).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "step 4" })); expect(pick).toHaveBeenCalledWith("e2"); expect(screen.getByText(/the exact events/).closest("details").open).toBe(false);
});

const APPROVAL = { id: 5, trace_id: "run-1", agent_name: "support", tool_name: "issue_refund", arguments: { amount: 250 }, reason: "Large refund", status: "pending", created_at: "2026-01-01T00:00:00", expires_at: "2026-01-01T01:00:00" };
test("ApprovalCard: approving is one click, rejecting needs a note, viewers cannot decide", () => {
  const decide = vi.fn();
  const { rerender } = render(<ApprovalCard approval={APPROVAL} canDecide onDecide={decide} />);
  const reject = screen.getByRole("button", { name: "Reject" }); expect(reject.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Approve once" })); expect(decide).toHaveBeenLastCalledWith("approve", "");
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "under review" } }); fireEvent.click(reject); expect(decide).toHaveBeenLastCalledWith("reject", "under review");
  rerender(<ApprovalCard approval={APPROVAL} canDecide={false} onDecide={decide} />); expect(screen.queryByRole("button", { name: "Approve once" })).toBeNull(); expect(screen.getByText(/Only members and admins/)).toBeTruthy();
  rerender(<ApprovalCard approval={{ ...APPROVAL, status: "approved", decided_by: "ada@x.io", decision_note: "ok", consumed: true }} onDecide={decide} />); expect(screen.getByText(/Decided by ada@x.io/)).toBeTruthy(); expect(screen.getByText(/used/)).toBeTruthy();
});

const RULE = { id: 1, name: "limit_refunds", description: "Stop big refunds", category: "approval", enabled: true, version: 2, n_versions: 2, evaluations: 10, matches: 3, definition: { scope: { agents: ["*"], tools: ["issue_refund"] }, condition: { type: "argument_compare" }, action: "REQUIRE_APPROVAL", severity: "high" } };
test("SafetyRuleCard shows the rule in words and respects permissions", () => {
  const toggle = vi.fn(), edit = vi.fn();
  const { rerender } = render(<SafetyRuleCard rule={RULE} canEdit conditionText="Argument amount is over 100" onToggle={toggle} onEdit={edit} onHistory={vi.fn()} />);
  expect(screen.getByText(/Argument amount is over 100/)).toBeTruthy(); expect(screen.getByText("10 checks · 3 triggered")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Enable limit_refunds" })); expect(toggle).toHaveBeenCalledWith(RULE, false);
  rerender(<SafetyRuleCard rule={RULE} canEdit={false} conditionText="x" onToggle={toggle} onEdit={edit} onHistory={vi.fn()} />); expect(screen.getByRole("switch").disabled).toBe(true); expect(screen.getByText("View / test")).toBeTruthy();
});

test("ScenarioCard says whether AgentGuard should react or stay quiet", () => {
  const open = vi.fn(), s = (cats) => ({ id: "s-1", category: "workflow", description: "[SYNTHETIC] desc", n_events: 4, split: "dev", preview: [{ t: "run_start", s: "ok" }], labels: { failure_categories: cats, earliest_detectable_step: 0, expected_action: "escalate" } });
  const { rerender } = render(<MetaCtx.Provider value={META}><ScenarioCard scenario={s(["workflow_invariant_violation"])} onOpen={open} /></MetaCtx.Provider>);
  expect(screen.getByText("Steps out of order")).toBeTruthy(); expect(screen.getByText(/Hand to a human/)).toBeTruthy(); fireEvent.click(screen.getByLabelText("Open s-1")); expect(open).toHaveBeenCalled();
  rerender(<MetaCtx.Provider value={META}><ScenarioCard scenario={s([])} onOpen={open} /></MetaCtx.Provider>); expect(screen.getByText(/should stay quiet/)).toBeTruthy();
});

test("ActivityTimeline lists who did what and loads older entries", () => {
  const more = vi.fn();
  render(<ActivityTimeline items={[{ id: 1, kind: "activity", label: "Benchmark run", target: "r1", actor: "ada@x.io", ts: "2026-01-01T00:00:00", detail: { scenarios: "all" } }]} linkFor={(a) => "#/bench?run=" + a.target} hasMore remaining={5} onMore={more} />);
  expect(screen.getByText("Benchmark run")).toBeTruthy(); expect(screen.getByText("r1").getAttribute("href")).toBe("#/bench?run=r1"); expect(screen.getByText(/scenarios: all/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Show more \(5 older\)/ })); expect(more).toHaveBeenCalled();
});

test("BenchmarkComparison renders the with/without legend", () => {
  render(<BenchmarkComparison rows={[{ label: "Safe outcome", without: 0.3, with: 0.9 }]} caption="Green taller is better." />);
  expect(screen.getByText("Green taller is better.")).toBeTruthy();
});

test("IntegrationWizard walks through four steps and fills the snippet with the agent name and key", () => {
  const register = vi.fn(async () => true), createKey = vi.fn(), check = vi.fn();
  const props = { agentName: "refund-bot", onAgentNameChange: vi.fn(), onRegister: register, registered: false, apiKey: null, onCreateKey: createKey, canCreateKey: true, install: "pip install -e sdk", snippet: 'AgentGuard(api_key="YOUR_API_KEY")\ntrace(agent_name="AGENT_NAME")', connection: { state: "waiting", runs: 0 }, onCheck: check, busy: false };
  const { rerender } = render(<IntegrationWizard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Register this agent" }));
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    expect(register).toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: /Create a key for “refund-bot”/ })); expect(createKey).toHaveBeenCalled();
    rerender(<IntegrationWizard {...props} apiKey={{ key: "ag_secret" }} />); expect(screen.getByText("ag_secret")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/api_key="ag_secret"/)).toBeTruthy(); expect(screen.getByText(/agent_name="refund-bot"/)).toBeTruthy();    // placeholders replaced
    fireEvent.click(screen.getByRole("button", { name: /check/ })); expect(check).toHaveBeenCalled(); expect(screen.getByText(/Waiting for the first run/)).toBeTruthy();
    rerender(<IntegrationWizard {...props} apiKey={{ key: "ag_secret" }} connection={{ state: "connected", runs: 2 }} />); expect(screen.getByText(/Connected/)).toBeTruthy();
  });
});
