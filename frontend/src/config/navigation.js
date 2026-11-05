// Navigation as data: add a page here and it appears in the sidebar and header.
export const NAV_GROUPS = [
  { label: "Monitor", items: [
    { path: "/overview", icon: "◉", label: "Overview", subtitle: "How healthy your agents are right now" },
    { path: "/agents", icon: "🤖", label: "Agents", subtitle: "Every agent AgentGuard is watching, and how it is doing" },
    { path: "/traces", icon: "☰", label: "Agent Runs", subtitle: "Every run, and what went wrong in it" },
    { path: "/problems", icon: "⚠", label: "Problems", subtitle: "Everything AgentGuard has found, most serious first" },
    { path: "/risk", icon: "📈", label: "Risk Monitor", subtitle: "Runs that look like they are heading for trouble, and how often the warnings were right" },
  ] },
  { label: "Protect", items: [
    { path: "/policies", icon: "🛡", label: "Safety Rules", subtitle: "The rules agents must follow, checked before every action" },
    { path: "/approvals", icon: "✋", label: "Approvals", subtitle: "Actions waiting for a person to say yes or no" },
  ] },
  { label: "Prove it works", items: [
    { path: "/scenarios", icon: "❖", label: "Scenarios", subtitle: "The test cases behind the benchmark" },
    { path: "/bench", icon: "⚗", label: "Benchmark Lab", subtitle: "Test AgentGuard against cases with known answers" },
  ] },
  { label: "Manage", items: [
    { path: "/history", icon: "🕘", label: "Activity", subtitle: "What happened, who did it, and how results changed over time" },
    { path: "/integrations", icon: "🔌", label: "Connect an agent", subtitle: "Add an agent in four steps" },
    { path: "/settings", icon: "⚙", label: "Settings", subtitle: "Everything you can configure, explained" },
  ] },
];
export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);
export const findNav = (section) => ALL_NAV.find((n) => n.path === section) ?? ALL_NAV[0];
