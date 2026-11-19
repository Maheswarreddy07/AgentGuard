import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MetaCtx } from "../hooks/context";
import AgentCard from "../components/AgentCard";
import AgentPicker from "../components/AgentPicker";
import ActivityTimeline from "../components/ActivityTimeline";
import ConfirmDelete from "../components/ConfirmDelete";
import TopNav from "../components/TopNav";
import SubNav from "../components/SubNav";
import ApprovalCard from "../components/ApprovalCard";
import BenchmarkComparison from "../components/BenchmarkComparison";
import EmptyState from "../components/EmptyState";
import IntegrationWizard from "../components/IntegrationWizard";
import LoadingState from "../components/LoadingState";
import PageHeader from "../components/PageHeader";
import ProblemCard from "../components/ProblemCard";
import ProblemDetails from "../components/ProblemDetails";
import SafetyRuleCard from "../components/SafetyRuleCard";
import TestCard from "../components/TestCard";
import MakeTest from "../components/MakeTest";
import TechnicalDetails from "../components/TechnicalDetails";
import { applyTheme } from "../ui";

import CAT from "./catalog.json";
const META = { access: CAT.access.admin, ui: CAT.ui, categories: { workflow_invariant_violation: { label: "Steps out of order" } }, actions: { escalate: { icon: "🙋", label: "Hand to a human" } }, severities: ["low", "high"], severity_colors: { high: "#f90", low: "#00f" } };
beforeAll(() => applyTheme(META));

const SECTIONS = [{ key: "safety", label: "Safety", tabs: [{ path: "/policies", icon: "🛡", label: "Safety rules" }, { path: "/approvals", icon: "✋", label: "Approvals" }] }, { key: "home", label: "Home", tabs: [{ path: "/overview", icon: "◉", label: "Home" }] }];
const NAVPROPS = (o = {}) => ({ sections: SECTIONS, profile: [{ path: "/settings", icon: "⚙", label: "Settings" }], activeSection: "safety", activePath: "/approvals", onNavigate: vi.fn(), user: { name: "Ada", email: "a@x.io" }, roleName: "Admin", authRequired: true, onSignOut: vi.fn(), apiStatus: "up", badges: { "/approvals": 3 }, text: CAT.ui.shell, ...o });

test("TopNav shows the sections across the top, marks the current one, shows waiting approvals and navigates", () => {
  const p = NAVPROPS(); render(<TopNav {...p} />);
  const nav = screen.getByRole("navigation", { name: p.text.nav_label }); expect(within(nav).getByRole("button", { name: /Safety/ }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("button", { name: /Home/ }).getAttribute("aria-current")).toBeNull(); expect(within(nav).getByLabelText("3 waiting")).toBeTruthy();
  fireEvent.click(within(nav).getByRole("button", { name: /Home/ })); expect(p.onNavigate).toHaveBeenLastCalledWith("/overview");
  fireEvent.click(within(nav).getByRole("button", { name: /Safety/ })); expect(p.onNavigate).toHaveBeenLastCalledWith("/policies");       // a section opens its first page
});

test("the mobile menu lists every page of every section, opens with the three-line button and closes on Escape", () => {
  const p = NAVPROPS(); render(<TopNav {...p} />); const burger = screen.getByRole("button", { name: p.text.menu_open }); expect(burger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(burger); const panel = document.getElementById("app-menu"); expect(burger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(within(panel).getByRole("button", { name: /Safety rules/ })); expect(p.onNavigate).toHaveBeenLastCalledWith("/policies");
  fireEvent.click(screen.getByRole("button", { name: p.text.menu_open })); fireEvent.keyDown(window, { key: "Escape" }); expect(screen.getByRole("button", { name: p.text.menu_open }).getAttribute("aria-expanded")).toBe("false");
});

test("the account menu holds Settings and sign out, and no Simple/Advanced or demo-data switch", () => {
  const p = NAVPROPS(), T = p.text; render(<TopNav {...p} />);
  fireEvent.click(screen.getByRole("button", { name: T.profile_label })); const dlg = screen.getByRole("dialog", { name: T.profile_label });
  expect(within(dlg).queryByText(/Simple|Advanced|Demo data|Real activity/i)).toBeNull(); expect(within(dlg).queryByRole("group")).toBeNull();
  fireEvent.click(within(dlg).getByRole("button", { name: /Settings/ })); expect(p.onNavigate).toHaveBeenLastCalledWith("/settings"); expect(screen.queryByRole("dialog", { name: T.profile_label })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: T.profile_label })); fireEvent.click(screen.getByRole("button", { name: T.sign_out })); expect(p.onSignOut).toHaveBeenCalled();
});

test("the account menu offers My account and Connection settings, both opening the matching Settings tab", () => {
  const p = NAVPROPS(), T = p.text; render(<TopNav {...p} />);
  fireEvent.click(screen.getByRole("button", { name: T.profile_label })); fireEvent.click(within(screen.getByRole("dialog", { name: T.profile_label })).getByRole("button", { name: T.my_account }));
  expect(p.onNavigate).toHaveBeenLastCalledWith("/settings?tab=account");
  fireEvent.click(screen.getByRole("button", { name: T.profile_label })); fireEvent.click(within(screen.getByRole("dialog", { name: T.profile_label })).getByRole("button", { name: T.connection_settings }));
  expect(p.onNavigate).toHaveBeenLastCalledWith("/settings?tab=keys");
});

test("SubNav shows the pages of a section only when there is more than one", () => {
  const go = vi.fn(), { rerender } = render(<SubNav tabs={SECTIONS[0].tabs} activePath="/policies" onNavigate={go} label="Pages" badges={{ "/approvals": 2 }} />);
  expect(screen.getByRole("button", { name: /Safety rules/ }).getAttribute("aria-current")).toBe("page"); fireEvent.click(screen.getByRole("button", { name: /Approvals/ })); expect(go).toHaveBeenCalledWith("/approvals");
  rerender(<SubNav tabs={SECTIONS[1].tabs} activePath="/overview" onNavigate={go} label="Pages" />); expect(screen.queryByRole("navigation")).toBeNull();
});

test("PageHeader, EmptyState, LoadingState and TechnicalDetails", () => {
  const retry = vi.fn();
  render(<MetaCtx.Provider value={META}><PageHeader title="Agents" subtitle="Plain words" actions={<button>Add</button>} /><EmptyState title="Nothing here" icon="🗂" action={<button>Do it</button>} /><LoadingState error="boom" onRetry={retry} /><TechnicalDetails data={{ a: 1 }} /></MetaCtx.Provider>);
  expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy(); expect(screen.getByText("Plain words")).toBeTruthy(); expect(screen.getByText("Nothing here")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(retry).toHaveBeenCalled();
  const d = screen.getByText("Technical details").closest("details"); expect(d.open).toBe(false);          // raw data stays tucked away by default
});

const AGENTS = [{ id: 1, name: "support", description: "Handles refunds", environment: "prod", runs: 10, flagged_runs: 6, blocked_actions: 2, avg_risk: 40, last_seen_at: "2026-01-01T00:00:00", connection: "connected", quiet_after_days: 7, integration: "sdk", open_problems: 3, open_serious: 1, recent_activity: [] },
  { id: 2, name: "idle", runs: 0, flagged_runs: 0, blocked_actions: 0, avg_risk: null, environment: "dev", last_seen_at: null, connection: "waiting", quiet_after_days: 7, integration: null, open_problems: 0, open_serious: 0, recent_activity: [] }];
test("AgentCard shows connection, integration and health in plain language and open the agent", () => {
  const open = vi.fn();
  render(<MetaCtx.Provider value={META}><AgentCard agent={AGENTS[0]} onOpen={open} /></MetaCtx.Provider>);
  expect(screen.getByText(CAT.ui.agents.connection.connected.label)).toBeTruthy(); expect(screen.getByText(CAT.ui.agents.integration.sdk)).toBeTruthy(); expect(screen.getByText(/3 open problem/)).toBeTruthy();
  expect(screen.getAllByText("Needs attention").length).toBe(1); expect(screen.getByText(/last seen/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open runs of support" })); expect(open).toHaveBeenCalledWith(AGENTS[0]);
});

test("AgentPicker chooses all agents or only some, and can add a name that is not registered yet", () => {
  const onChange = vi.fn(), T = CAT.ui.safety; const { rerender } = render(<MetaCtx.Provider value={META}><AgentPicker value="*" known={["support", "billing"]} onChange={onChange} /></MetaCtx.Provider>);
  expect(screen.getByRole("radio", { name: T.all_agents }).checked).toBe(true); fireEvent.click(screen.getByRole("radio", { name: T.only_these })); expect(onChange).toHaveBeenLastCalledWith("support");
  rerender(<MetaCtx.Provider value={META}><AgentPicker value="support" known={["support", "billing"]} onChange={onChange} /></MetaCtx.Provider>);
  fireEvent.click(screen.getByRole("checkbox", { name: "billing" })); expect(onChange).toHaveBeenLastCalledWith("support, billing");
  fireEvent.change(screen.getByLabelText(T.extra_label), { target: { value: "new-bot" } }); fireEvent.click(screen.getByRole("button", { name: T.add })); expect(onChange).toHaveBeenLastCalledWith("support, new-bot");
  fireEvent.click(screen.getByRole("checkbox", { name: "support" })); expect(onChange).toHaveBeenLastCalledWith("*");                      // nothing selected means every agent
});

const PROBLEM = { id: "abc", trace_id: "run-1", label: "Action without approval", severity: "high", description: "Refund ran without approval.", source: "rule", detected_at: "2026-01-01T00:00:00", why: "Money moved with no human check.", fix: "Require approval.", confidence: 1, evidence_event_ids: ["e2"] };
test("ProblemCard summarises and ProblemDetails explains why it matters, with evidence behind a toggle", () => {
  const open = vi.fn(), pick = vi.fn();
  render(<MetaCtx.Provider value={META}><><ProblemCard problem={PROBLEM} onOpen={open} /><ProblemDetails problem={PROBLEM} evidenceEvents={[{ event_id: "e2" }]} onSelectEvent={pick} stepOf={() => 4} /></></MetaCtx.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "See details" })); expect(open).toHaveBeenCalledWith(PROBLEM);
  expect(screen.getByText(/Money moved with no human check/)).toBeTruthy(); expect(screen.getByText(/Require approval/)).toBeTruthy(); expect(screen.getAllByText("proven by rule").length).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "step 4" })); expect(pick).toHaveBeenCalledWith("e2"); expect(screen.getByText(/the exact events/).closest("details").open).toBe(false);
});

const APPROVAL = { id: 5, trace_id: "run-1", agent_name: "support", tool_name: "issue_refund", arguments: { amount: 250 }, reason: "Large refund", status: "pending", created_at: "2026-01-01T00:00:00", expires_at: "2026-01-01T01:00:00" };
test("ApprovalCard: approving is one click, rejecting needs a note, viewers cannot decide", () => {
  const decide = vi.fn();
  const { rerender } = render(<MetaCtx.Provider value={META}><ApprovalCard approval={APPROVAL} canDecide onDecide={decide} /></MetaCtx.Provider>);
  const reject = screen.getByRole("button", { name: "Reject" }); expect(reject.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Approve once" })); expect(decide).toHaveBeenLastCalledWith("approve", "");
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "under review" } }); fireEvent.click(reject); expect(decide).toHaveBeenLastCalledWith("reject", "under review");
  rerender(<MetaCtx.Provider value={META}><ApprovalCard approval={APPROVAL} canDecide={false} onDecide={decide} /></MetaCtx.Provider>); expect(screen.queryByRole("button", { name: "Approve once" })).toBeNull(); expect(screen.getByText(/Only members and admins/)).toBeTruthy();
  rerender(<MetaCtx.Provider value={META}><ApprovalCard approval={{ ...APPROVAL, status: "approved", decided_by: "ada@x.io", decision_note: "ok", consumed: true }} onDecide={decide} /></MetaCtx.Provider>); expect(screen.getByText(/Decided by ada@x.io/)).toBeTruthy(); expect(screen.getByText(/used/)).toBeTruthy();
});

const RULE = { id: 1, name: "limit_refunds", description: "Stop big refunds", category: "approval", enabled: true, version: 2, n_versions: 2, evaluations: 10, matches: 3, definition: { scope: { agents: ["*"], tools: ["issue_refund"] }, condition: { type: "argument_compare" }, action: "REQUIRE_APPROVAL", severity: "high" } };
test("SafetyRuleCard shows the rule in words and respects permissions", () => {
  const toggle = vi.fn(), edit = vi.fn();
  const { rerender } = render(<MetaCtx.Provider value={META}><SafetyRuleCard rule={RULE} canEdit conditionText="Argument amount is over 100" onToggle={toggle} onEdit={edit} onHistory={vi.fn()} /></MetaCtx.Provider>);
  expect(screen.getByText(/Argument amount is over 100/)).toBeTruthy(); expect(screen.getByText("10 checks · 3 triggered")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Enable limit_refunds" })); expect(toggle).toHaveBeenCalledWith(RULE, false);
  rerender(<MetaCtx.Provider value={META}><SafetyRuleCard rule={RULE} canEdit={false} conditionText="x" onToggle={toggle} onEdit={edit} onHistory={vi.fn()} /></MetaCtx.Provider>); expect(screen.getByRole("switch").disabled).toBe(true); expect(screen.getByText("View / test")).toBeTruthy();
});

test("TestCard shows the real last result, never a guess, and keeps identifiers inside Technical details", () => {
  const run = vi.fn(), t = (last) => ({ key: "k", group: "safety", name: "Require approval", summary: "sum", checks: "chk", expected: "exp", also: ["unused"], n_cases: 3, scenario_ids: ["adv-04"], technical: [{ id: "adv-04", description: "d", steps: 4, split: "dev", source: "builtin" }], last });
  const L = CAT.ui.tests.library, { rerender } = render(<MetaCtx.Provider value={META}><TestCard test={t(null)} onRun={run} /></MetaCtx.Provider>);
  expect(screen.getByText(L.not_tested)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: L.run })); expect(run).toHaveBeenCalled();
  expect(screen.getByText("adv-04").closest("details")).toBeTruthy();
  rerender(<MetaCtx.Provider value={META}><TestCard test={t({ passed: 3, total: 3, at: "2026-01-01T00:00:00" })} onRun={run} /></MetaCtx.Provider>); expect(screen.getByText(L.passed)).toBeTruthy();
  rerender(<MetaCtx.Provider value={META}><TestCard test={t({ passed: 0, total: 3, at: null })} onRun={run} /></MetaCtx.Provider>); expect(screen.getByText(L.failed)).toBeTruthy();
  rerender(<MetaCtx.Provider value={META}><TestCard test={t({ passed: 2, total: 3, at: null })} onRun={run} canRun={false} /></MetaCtx.Provider>); expect(screen.getByText("2 of 3 passed")).toBeTruthy(); expect(screen.getByRole("button", { name: L.run }).disabled).toBe(true);
});

test("ActivityTimeline lists who did what and loads older entries", () => {
  const more = vi.fn();
  render(<MetaCtx.Provider value={META}><ActivityTimeline items={[{ id: 1, kind: "activity", label: "Benchmark run", target: "r1", actor: "ada@x.io", ts: "2026-01-01T00:00:00", detail: { scenarios: "all" } }]} linkFor={(a) => "#/bench?run=" + a.target} hasMore remaining={5} onMore={more} /></MetaCtx.Provider>);
  expect(screen.getByText("Benchmark run")).toBeTruthy(); expect(screen.getByText("r1").getAttribute("href")).toBe("#/bench?run=r1"); expect(screen.getByText(/scenarios: all/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Show more \(5 older\)/ })); expect(more).toHaveBeenCalled();
});

test("BenchmarkComparison renders the with/without legend", () => {
  render(<BenchmarkComparison rows={[{ label: "Safe outcome", without: 0.3, with: 0.9 }]} caption="Green taller is better." />);
  expect(screen.getByText("Green taller is better.")).toBeTruthy();
});

test("IntegrationWizard guides a non-technical person: name, key, file, run, check; everything it says comes from the server text", async () => {
  const T = CAT.ui.connect, register = vi.fn(async () => true), createKey = vi.fn(), check = vi.fn(), download = vi.fn();
  const props = { text: T.mine, labels: { back: T.back_step, next: T.next, agent_label: T.agent_label, agent_hint: T.agent_hint, agent_placeholder: T.agent_placeholder }, agentName: "refund-bot", onAgentNameChange: vi.fn(), onRegister: register, registered: false, apiKey: null, onCreateKey: createKey, canCreateKey: true,
    pastedKey: "", onPasteKey: vi.fn(), starter: { filename: "agentguard_refund-bot.py", content: "x" }, onDownload: download, connection: { state: "waiting", runs: 0 }, onCheck: check, busy: false, onSeeRuns: vi.fn(), onDeveloper: vi.fn() };
  const { rerender } = render(<MetaCtx.Provider value={META}><IntegrationWizard {...props} /></MetaCtx.Provider>);
  fireEvent.click(screen.getByRole("button", { name: T.mine.steps[0].button })); await waitFor(() => expect(register).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole("button", { name: T.mine.steps[1].button })); expect(createKey).toHaveBeenCalled();
  rerender(<MetaCtx.Provider value={META}><IntegrationWizard {...props} apiKey="ag_secret" /></MetaCtx.Provider>); expect(screen.getByText("ag_secret")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: T.next })); fireEvent.click(screen.getByRole("button", { name: new RegExp(T.mine.steps[2].button) })); expect(download).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: T.next })); expect(screen.getByText(T.mine.steps[3].python_title)).toBeTruthy(); expect(screen.getByText(/^Windows:/)).toBeTruthy(); expect(screen.getByText("python agentguard_refund-bot.py")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: T.mine.steps[3].next })); expect(check).toHaveBeenCalled(); expect(screen.getByText(/Waiting for the first run/)).toBeTruthy();
  rerender(<MetaCtx.Provider value={META}><IntegrationWizard {...props} apiKey="ag_secret" connection={{ state: "connected", runs: 2 }} /></MetaCtx.Provider>); expect(screen.getByText(/Connected/)).toBeTruthy();
});

test("ConfirmDelete always asks first, shows what will be deleted, reports errors and only then deletes", async () => {
  const D = CAT.ui.delete, onConfirm = vi.fn().mockRejectedValueOnce(new Error("still in use")).mockResolvedValueOnce(undefined), onDone = vi.fn();
  render(<MetaCtx.Provider value={META}><ConfirmDelete kind="agent" vars={{ name: "orders-agent", n: 3 }} onConfirm={onConfirm} onDone={onDone} /></MetaCtx.Provider>);
  fireEvent.click(screen.getByRole("button", { name: /Delete/ })); expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toBeTruthy(); expect(screen.getByText(/orders-agent/, { selector: "h3" })).toBeTruthy(); expect(screen.getByText(/its 3 runs/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: D.cancel })); expect(screen.queryByRole("alertdialog")).toBeNull(); expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Delete/ })); fireEvent.click(screen.getByRole("button", { name: D.confirm }));
  expect(await screen.findByText(/still in use/)).toBeTruthy(); expect(onDone).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: D.confirm })); await waitFor(() => expect(onDone).toHaveBeenCalled()); expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("the theme button cycles match-my-device, light, dark and says which one is active", () => {
  const T = CAT.ui.shell, onTheme = vi.fn(), props = NAVPROPS({ onTheme });
  const { rerender } = render(<TopNav {...props} theme="system" />);
  const btn = () => screen.getByRole("button", { name: new RegExp(T.theme_label) });
  expect(btn().getAttribute("aria-label")).toContain(T.theme.system); fireEvent.click(btn()); expect(onTheme).toHaveBeenLastCalledWith("light");
  rerender(<TopNav {...props} theme="light" />); expect(btn().getAttribute("aria-label")).toContain(T.theme.light); fireEvent.click(btn()); expect(onTheme).toHaveBeenLastCalledWith("dark");
  rerender(<TopNav {...props} theme="dark" />); fireEvent.click(btn()); expect(onTheme).toHaveBeenLastCalledWith("system");
});

test("API reads never ask for demo data: production is the only view", async () => {
  const seen = []; globalThis.fetch = vi.fn(async (u) => { seen.push(String(u)); return { ok: true, status: 200, json: async () => ({}) }; });
  localStorage.setItem("ag.scope", "synthetic");      // a leftover setting from the old interface must have no effect
  const { api } = await import("../api/client");
  await api("/api/v1/traces?limit=5"); expect(seen.at(-1)).toBe("/api/v1/traces?limit=5");
  await api("/api/v1/traces"); expect(seen.at(-1)).toBe("/api/v1/traces"); localStorage.removeItem("ag.scope");
});

test("MakeTest shows what is kept and removed and saves nothing until the person confirms", async () => {
  const P = CAT.ui.problems, preview = vi.fn(async () => ({ n_events: 9, kept: ["tool names"], removed: ["all text"], failure_categories: ["repeated_failures"], not_preserved: ["prompt_injection_indicator"] })), create = vi.fn(async () => ({}));
  render(<MetaCtx.Provider value={META}><MakeTest traceId="t-1" preview={preview} create={create} /></MetaCtx.Provider>);
  fireEvent.click(screen.getByRole("button", { name: P.make_test })); await waitFor(() => screen.getByText(/tool names/));
  expect(screen.getByText(/all text/)).toBeTruthy(); const save = screen.getByRole("button", { name: P.test_save }); expect(save.disabled).toBe(true);   // not without confirming
  fireEvent.click(screen.getByRole("checkbox", { name: P.test_confirm })); expect(save.disabled).toBe(false); fireEvent.click(save);
  await waitFor(() => screen.getByText(P.test_saved)); expect(create).toHaveBeenCalledWith("t-1", { confirm_reviewed: true, failure_categories: ["repeated_failures"] });
});

test("MakeTest cannot save when nothing survives the removal of text", async () => {
  const P = CAT.ui.problems, preview = async () => ({ n_events: 3, kept: [], removed: [], failure_categories: [], not_preserved: ["prompt_injection_indicator"] });
  render(<MetaCtx.Provider value={META}><MakeTest traceId="t-2" preview={preview} create={vi.fn()} /></MetaCtx.Provider>);
  fireEvent.click(screen.getByRole("button", { name: P.make_test })); await waitFor(() => screen.getByText(P.test_none));
  fireEvent.click(screen.getByRole("checkbox", { name: P.test_confirm })); expect(screen.getByRole("button", { name: P.test_save }).disabled).toBe(true);
});
