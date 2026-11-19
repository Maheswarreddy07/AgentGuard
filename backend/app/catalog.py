"""Plain-English metadata used by the API and UI so nothing shows up as an unexplained identifier."""
import json
from pathlib import Path
CATEGORIES = {
 "invalid_tool_arguments": {"title": 'The agent used incorrect information', "plain": 'The agent tried to perform an action using incorrect or incomplete information.', "label": "Invalid tool arguments", "why": "The agent called a tool with inputs that break the tool's declared schema, so the call fails or does the wrong thing.", "fix": "Validate arguments against the schema before calling; correct and retry only if the tool is read-only."},
 "tool_execution_failure": {"title": 'A tool the agent relies on failed', "plain": 'An action the agent tried to perform did not work because the tool returned an error.', "label": "Tool failed", "why": "A tool returned an error. Transient errors may be retried; permanent ones need a different approach.", "fix": "Retry (bounded, read-only tools only) for transient errors; otherwise escalate."},
 "repeated_failures": {"title": 'The agent kept retrying something that fails', "plain": 'The agent tried the same action again and again even though it failed every time.', "label": "Stuck in a retry loop", "why": "The same tool failed the same way several times in a row. More retries waste time and can cause side effects.", "fix": "Stop and escalate to a human."},
 "unauthorized_action": {"title": 'An important action happened without permission', "plain": 'The agent performed an important action without a person approving it first.', "label": "Action without approval", "why": "A consequential action (money, deletion, messages) ran without a prior, matching human approval.", "fix": "Block the action and request explicit approval."},
 "unsupported_success_claim": {"title": 'The agent said it succeeded, but it did not', "plain": 'The agent reported that the task was done although a step had actually failed.', "label": "False success claim", "why": "The agent reported success while a tool's latest result was still an unresolved error.", "fix": "Mark the run failed and escalate."},
 "incomplete_execution": {"title": 'A task was never finished', "plain": 'The agent stopped part-way and never reported that the task was complete.', "label": "Run never finished", "why": "The trace has no end event. The agent may have crashed, been abandoned, or still be running.", "fix": "Wait, or mark the run abandoned."},
 "missing_required_evidence": {"title": 'The agent finished without checking', "plain": 'The agent tried to finish the task without verifying the information it needed.', "label": "Missing required evidence", "why": "The run ended without successfully calling a tool the task required, so the conclusion is unsupported.", "fix": "Gather the missing evidence before concluding."},
 "contradictory_tool_results": {"title": 'Two results disagreed', "plain": 'The agent received two answers that contradict each other and carried on regardless.', "label": "Contradictory results", "why": "Two successful results about the same entity disagree, so at least one is wrong or stale.", "fix": "Request more evidence to resolve the conflict."},
 "workflow_invariant_violation": {"title": 'Steps happened in the wrong order', "plain": 'The agent did something before a step that has to come first, such as checking identity before a refund.', "label": "Steps out of order", "why": "A step that must come after another (e.g. refund after identity check) happened first.", "fix": "Stop and escalate; the required order was not followed."},
 "goal_constraint_violation": {"title": 'The agent went past a limit', "plain": 'The agent went beyond a limit it was given, such as a maximum amount.', "label": "Task limit exceeded", "why": "A tool input went beyond a limit set for this task (for example a refund above the allowed amount).", "fix": "Block and request human approval."},
}
CATEGORIES.update({
 "repeated_tool_calls": {"title": 'The agent repeated the same action', "plain": 'The agent repeated the same action several times.', "label": "Repeated calls", "why": "The agent keeps making the same successful call again and again, wasting time and money and hiding that it is stuck.", "fix": "Stop and replan; reuse the earlier result."},
 "infinite_loop": {"title": 'The agent went round in circles', "plain": 'The agent kept repeating the same steps without making progress.', "label": "Going in circles", "why": "The agent repeats the same sequence of steps, or keeps getting identical answers, without making progress.", "fix": "Stop the run and replan with different information."},
 "resource_exhaustion": {"title": 'The task used more than it should', "plain": 'The agent used more steps, time or cost than the task was allowed.', "label": "Budget exceeded", "why": "The run used more tool calls, tokens, cost or time than its limit allows.", "fix": "Stop the run and review why it needed so much."},
 "sensitive_data_exposure": {"title": 'Private information was at risk', "plain": 'Personal or secret information was sent somewhere it should not go.', "label": "Sensitive data exposed", "why": "Personal or secret data was sent to an external tool or included in the agent's final answer.", "fix": "Block the action and require approval; remove the data."},
 "prompt_injection_indicator": {"title": 'Something tried to give the agent new orders', "plain": 'Text returned by a tool looked like instructions meant to take control of the agent.', "label": "Possible prompt injection", "why": "Content the agent received from a tool contains instruction-like text that could try to take control of the agent.", "fix": "Treat the content as untrusted data and review the next actions."},
})
SEVERITIES = ["info", "low", "medium", "high", "critical"]
SEVERITY_COLORS = {"info": "#8b93a7", "critical": "#ff5d73", "high": "#ff9f43", "medium": "#ffd166", "low": "#7aa2f7"}
SEV_RANK = {s: i + 1 for i, s in enumerate(SEVERITIES)}
ACTIONS = {
 "none": {"icon": "✓", "label": "No action needed", "plain": "Nothing actionable was found, so AgentGuard leaves the run alone."},
 "retry": {"icon": "↻", "label": "Retry safely", "plain": "A transient failure on a read-only tool: retry with a small, bounded number of attempts."},
 "correct_args": {"icon": "✎", "label": "Fix the arguments", "plain": "Correct the inputs against the tool schema and retry once (read-only tools only)."},
 "request_evidence": {"icon": "🔎", "label": "Ask for more evidence", "plain": "Gather the missing or conflicting information before the agent concludes."},
 "escalate": {"icon": "🙋", "label": "Hand to a human", "plain": "Unsafe to continue automatically. A person must approve or take over."},
 "stop": {"icon": "⛔", "label": "Stop the run", "plain": "Repeating further is unsafe. Halt and investigate."},
}
METRICS = {
 "precision": {"label": "Precision", "plain": "Of the failures AgentGuard flagged, how many were real. High = few false alarms."},
 "recall": {"label": "Recall", "plain": "Of the real failures, how many AgentGuard caught. High = few misses."},
 "f1": {"label": "F1", "plain": "One number balancing precision and recall."},
 "macro_f1": {"label": "Macro-F1", "plain": "F1 averaged across failure types, so rare types count as much as common ones."},
 "false_positive_rate": {"label": "False-alarm rate", "plain": "Share of perfectly good runs that were wrongly flagged."},
 "localization": {"label": "Pinpoint accuracy", "plain": "How often AgentGuard names exactly the right step where the failure first became detectable."},
 "task_success": {"label": "Task success", "plain": "Share of runs that finished the task correctly, with no violation."},
 "safe_outcome": {"label": "Safe outcome", "plain": "Share of runs that succeeded, were recovered, or were stopped before doing harm."},
 "recovery_success": {"label": "Recovery success", "plain": "Of the runs where AgentGuard tried automatic recovery, how many it fixed."},
 "unnecessary_intervention": {"label": "Unnecessary interventions", "plain": "Share of good runs where AgentGuard stepped in anyway."},
 "latency": {"label": "Added latency", "plain": "Extra time AgentGuard's analysis adds per run."},
}
RULES = {
 "repeated_calls": {"label": "Repeated calls", "description": "Flags the same (or near-identical) call succeeding several times.", "needs": "nothing extra (threshold is adjustable)"},
 "loop_detected": {"label": "Loops & no progress", "description": "Flags repeating step sequences and runs that keep getting identical answers.", "needs": "nothing extra"},
 "resource_exhaustion": {"label": "Budgets", "description": "Flags runs that exceed their tool-call, step, token, cost or time limits.", "needs": "a budget on the run"},
 "sensitive_exposure": {"label": "Sensitive data", "description": "Flags personal or secret data sent to external tools or shown in the final answer.", "needs": "external marked on outbound tools"},
 "injection_indicators": {"label": "Prompt-injection signs", "description": "Flags instruction-like text inside tool results (untrusted content).", "needs": "nothing extra"},
 "invalid_args": {"label": "Invalid tool arguments", "description": "Checks every tool call's inputs against the argument schema you declared.", "needs": "an arg_schema on the call"},
 "tool_failure": {"label": "Tool failures", "description": "Flags any tool result that came back as an error.", "needs": "nothing extra"},
 "retry_loop": {"label": "Retry loops", "description": "Flags the same tool failing the same way several times in a row.", "needs": "nothing extra (threshold is adjustable)"},
 "contradiction": {"label": "Contradictory results", "description": "Flags two successful results about the same entity that disagree.", "needs": "an entity name on results"},
 "missing_evidence": {"label": "Missing evidence", "description": "Flags runs that end without a successful call to a tool the task required.", "needs": "required_tools on the run"},
 "workflow_invariant": {"label": "Step order", "description": "Flags steps that happen before a step they depend on.", "needs": "must_precede rules on the run"},
 "goal_constraint": {"label": "Task limits", "description": "Flags tool inputs that exceed a limit set for the task.", "needs": "constraints on the run"},
 "unsupported_success": {"label": "False success claims", "description": "Flags runs that claim success while a tool's latest result is still an error.", "needs": "the run's final success claim"},
 "unauthorized_action": {"label": "Unapproved actions", "description": "Flags consequential actions that ran without a prior matching human approval.", "needs": "consequential marked on the call"},
 "incomplete": {"label": "Unfinished runs", "description": "Flags traces that never reached an end event.", "needs": "nothing extra"},
}
ACTIVITY = {
 "setup_completed": "First admin account created", "login": "Signed in", "login_failed": "Failed sign-in", "logout": "Signed out", "password_changed": "Password changed",
 "user_created": "User created", "user_updated": "User updated", "password_reset": "Password reset by admin", "api_key_created": "API key created", "api_key_revoked": "API key revoked", "api_key_deleted": "API key deleted", "problem_resolved": "Problem marked as resolved", "problem_reopened": "Problem reopened", "run_deleted": "Run deleted", "agent_deleted": "Agent deleted", "scenario_deleted": "Practice situation deleted", "policy_deleted": "Safety rule deleted", "user_deleted": "User deleted", "demo_data_removed": "Demo and sample data removed", "database_backup": "Database backup downloaded",
 "settings_updated": "Settings changed", "policy_created": "Policy created", "policy_updated": "Policy updated", "policy_toggled": "Policy switched on/off", "approval_decided": "Approval decision", "workspace_created": "Workspace created", "api_key_rotated": "API key rotated", "recovery_proposed": "Recovery proposed", "recovery_reported": "Recovery result recorded", "scenario_from_trace": "Scenario created from a run", "regression_run": "Regression suite run", "retention_run": "Old data cleaned up", "benchmark_started": "Benchmark run", "recovery_simulated": "Recovery simulated",
 "scenario_added": "Scenario added", "regression_test_created": "Test made from a real run", "demo_seeded": "Demo data loaded", "sample_run": "Sample agent run played", "ai_diagnosis_requested": "AI diagnosis requested",
}
SECURITY_ACTIONS = {"api_key_deleted", "policy_deleted", "user_deleted", "database_backup", "agent_deleted", "run_deleted", "demo_data_removed", "policy_created", "policy_updated", "policy_toggled", "workspace_created", "api_key_rotated", "setup_completed", "login", "login_failed", "logout", "password_changed", "user_created", "user_updated", "password_reset", "api_key_created", "api_key_revoked", "settings_updated", "retention_run"}
ROLES = [
 {"key": "viewer", "label": "Viewer", "home": "/overview", "plain": "Can look at everything but change nothing."},
 {"key": "member", "label": "Member", "home": "/overview", "plain": "Can also decide approvals, run benchmarks and simulations, connect agents, load demo data and add scenarios."},
 {"key": "admin", "label": "Admin", "home": "/overview", "plain": "Can also edit safety rules, manage people, API keys and settings, and see the security history."},
]
RISK_LEVELS = [{"key": "low", "min": 0}, {"key": "medium", "min": 25}, {"key": "high", "min": 50}, {"key": "critical", "min": 75}]
POLICY_ACTIONS = {"ALLOW": "Let it run", "WARN": "Let it run, but warn", "DEFER": "Hold until more information arrives", "REQUIRE_APPROVAL": "A human must approve first", "BLOCK": "Stop it before it runs"}
MODES = {"observe": "Only watch and record. Nothing is ever stopped.", "warn": "Warn about problems but never stop anything.", "enforce": "Stop actions that policies forbid and wait for required approvals."}


# Sample agent runs (simulated). Each one is picked from the benchmark scenarios by what it contains, never by a fixed id.
AGENT_QUIET_DAYS = 7      # an agent that has sent nothing for this long is shown as "quiet", not "connected"
SAMPLE_RUNS = [
 {"key": "normal", "label": "A normal run", "plain": "The agent does its job correctly. AgentGuard should stay quiet.", "failure": None},
 {"key": "no_approval", "label": "A risky action with no approval", "plain": "The agent does something important without anyone approving it. AgentGuard should notice.", "failure": "unauthorized_action"},
 {"key": "stuck", "label": "An agent stuck trying the same thing", "plain": "A tool keeps failing and the agent keeps retrying. AgentGuard should spot the loop.", "failure": "repeated_failures"},
 {"key": "hidden_instruction", "label": "A hidden instruction inside a tool result", "plain": "Text returned by a tool tries to give the agent new orders. AgentGuard should flag it.", "failure": "prompt_injection_indicator"},
]

# ---------- who can do what (the single source of truth for the UI *and* the API guards) ----------
CAPABILITIES = {
 "decide_approvals": {"min_role": "member", "label": "Approve or reject agent actions"},
 "connect_agents": {"min_role": "member", "label": "Connect a new agent"},
 "load_demo": {"min_role": "member", "label": "Load demo data"},
 "run_benchmark": {"min_role": "member", "label": "Run the benchmark"},
 "add_scenario": {"min_role": "member", "label": "Add your own practice situation"},
 "delete_data": {"min_role": "admin", "label": "Delete runs, agents and sample data"},
 "delete_scenario": {"min_role": "member", "label": "Delete your own practice situations"},
 "view_database": {"min_role": "admin", "label": "See the database status and download a backup"},
 "resolve_problems": {"min_role": "member", "label": "Mark problems as resolved"},
 "run_sample_agent": {"min_role": "member", "label": "Run a sample agent to see AgentGuard work"},
 "run_recovery": {"min_role": "member", "label": "Simulate a safe recovery"},
 "ask_ai_diagnosis": {"min_role": "member", "label": "Ask the AI to explain a run"},
 "edit_policies": {"min_role": "admin", "label": "Create and change safety rules"},
 "manage_team": {"min_role": "admin", "label": "Add people and change their roles"},
 "manage_keys": {"min_role": "admin", "label": "Create and revoke API keys"},
 "change_settings": {"min_role": "admin", "label": "Change settings and clean up old data"},
 "manage_workspaces": {"min_role": "admin", "label": "Create workspaces"},
 "view_security_log": {"min_role": "admin", "label": "See the security log"},
}
# The top navigation: six sections, each with a few tabs. `min_role` decides who sees a page at all. Pages with section "profile" live in the profile menu.
SECTIONS = [{"key": "home", "label": "Home"}, {"key": "agents", "label": "Agents"}, {"key": "activity", "label": "Activity"}, {"key": "problems", "label": "Problems"}, {"key": "safety", "label": "Safety"}, {"key": "test", "label": "Test & Improve"}]
PAGES = [
 {"section": "home", "path": "/overview", "icon": "◉", "label": "Home", "min_role": "viewer", "subtitle": "Is everything working? See how your agents are doing."},
 {"section": "agents", "path": "/agents", "icon": "🤖", "label": "Your agents", "min_role": "viewer", "subtitle": "The agents AgentGuard is watching, and how each one is doing"},
 {"section": "agents", "path": "/integrations", "icon": "🔌", "label": "Connect an agent", "min_role": "member", "subtitle": "Connect an agent in a few guided steps"},
 {"section": "activity", "path": "/activity", "icon": "🕒", "label": "Timeline", "min_role": "viewer", "subtitle": "What your agents have been doing, as it happened"},
 {"section": "activity", "path": "/traces", "icon": "☰", "label": "Runs", "min_role": "viewer", "subtitle": "What your agents have done, task by task"},
 {"section": "activity", "path": "/history", "icon": "🕘", "label": "Log", "min_role": "viewer", "subtitle": "What happened, who did it, and how results changed over time"},
 {"section": "problems", "path": "/problems", "icon": "⚠", "label": "Problems", "min_role": "viewer", "subtitle": "What went wrong, why it matters, and what to do next"},
 {"section": "problems", "path": "/risk", "icon": "📈", "label": "Early warnings", "min_role": "viewer", "subtitle": "Runs that look like they are heading for trouble"},
 {"section": "safety", "path": "/policies", "icon": "🛡", "label": "Rules", "min_role": "viewer", "subtitle": "The rules agents must follow, checked before every action"},
 {"section": "safety", "path": "/approvals", "icon": "✋", "label": "Approvals", "min_role": "viewer", "subtitle": "Actions waiting for a person to say yes or no"},
 {"section": "test", "path": "/scenarios", "icon": "❖", "label": "Test Library", "min_role": "viewer", "subtitle": "The situations AgentGuard can be tested against, in plain language"},
 {"section": "test", "path": "/run-tests", "icon": "▶", "label": "Run Tests", "min_role": "viewer", "subtitle": "Choose tests, check what will happen, and run them"},
 {"section": "test", "path": "/results", "icon": "✔", "label": "Results", "min_role": "viewer", "subtitle": "Is AgentGuard making agents safer? What every test run found"},
 {"section": "profile", "path": "/admin", "icon": "🛠", "label": "Team management", "min_role": "admin", "subtitle": "People, API keys, the database and security at a glance"},
 {"section": "profile", "path": "/settings", "icon": "⚙", "label": "Settings", "min_role": "viewer", "subtitle": "Everything you can configure, explained"},
]
_RANK = {"viewer": 1, "member": 2, "admin": 3}
def role_allows(role: str, min_role: str) -> bool: return _RANK.get(role, 0) >= _RANK[min_role]
def min_role_for(capability: str) -> str: return CAPABILITIES[capability]["min_role"]

def access_for(role: str) -> dict:
    """Everything the UI needs to know about what this role may see and do."""
    allowed = [pg for pg in PAGES if role_allows(role, pg["min_role"])]
    item = lambda pg: {k: pg[k] for k in ("path", "icon", "label", "subtitle")}
    sections = [{"key": sec["key"], "label": sec["label"], "tabs": [item(pg) for pg in allowed if pg["section"] == sec["key"]]} for sec in SECTIONS]
    return {"role": role, "home": "/overview", "sections": [x for x in sections if x["tabs"]], "profile": [item(pg) for pg in allowed if pg["section"] == "profile"], "pages": [pg["path"] for pg in allowed],
            "capabilities": {k: role_allows(role, v["min_role"]) for k, v in CAPABILITIES.items()},
            "capability_info": {k: {**v, "needs": next(r["label"] for r in ROLES if r["key"] == v["min_role"])} for k, v in CAPABILITIES.items()}}

# ---------- every sentence the pages show that is not data ----------
UI = {
 "access": {"denied_title": "This page is not part of your role", "denied_body": "You are signed in as {role}. This page needs the {needed} role.", "denied_action": "Go to my home page",
            "locked": "Needs the {needed} role", "read_only": "You can look but not change anything. Ask a member or admin."},
 "login": {"setup_title": "Welcome to AgentGuard", "setup_body": "First-time setup: create the administrator account. You will use it to invite your team and manage settings.", "login_title": "Sign in", "login_body": "Use your AgentGuard account to continue.",
           "name": "Your name", "name_placeholder": "Ada Lovelace", "email": "Email", "password": "Password", "confirm": "Confirm password", "show": "Show", "hide": "Hide", "session_ended": "Your session ended. Please sign in again.", "mismatch": "The two passwords don’t match.", "too_short": "Use at least {n} characters.",
           "pw_hint": "At least {n} characters. Passwords are stored as salted hashes, never in plain text.", "wait": "Please wait…", "create": "Create admin account", "submit": "Sign in"},
 "delete": {"button": "Delete", "cancel": "Keep it", "confirm": "Yes, delete", "working": "Deleting…", "failed": "Could not delete: {why}", "permanent": "This cannot be undone.", "done": "Deleted.",
   "run": {"title": "Delete this run?", "body": "“{name}” and everything found in it will be removed."},
   "agent": {"title": "Delete the agent “{name}”?", "body": "It is removed from AgentGuard together with its {n} runs. Your real agent is not touched and can connect again later."},
   "agent_empty": {"title": "Delete the agent “{name}”?", "body": "It has no runs. It is removed from the list."},
   "scenario": {"title": "Delete “{name}”?", "body": "This practice situation will no longer be used in benchmarks."},
   "rule": {"title": "Delete the safety rule “{name}”?", "body": "Agents will no longer be checked against it. Past decisions stay in the log."},
   "user": {"title": "Delete {name}?", "body": "This person can no longer sign in. Their past actions stay in the log."},
   "key": {"title": "Delete the key “{name}” for good?", "body": "It is already switched off. This removes it from the list."},
   "demo": {"title": "Remove all demo and sample data?", "body": "Runs created by “Load demo data”, “Try a sample agent” and the starter file are deleted. Real agent runs are not touched.", "button": "Remove demo and sample data", "done": "Removed {n} runs."}},
 "common": {"technical_toggle": "Show technical details", "load_more": "Loading more…", "end": "That is everything.", "see_all_agents": "See all agents →"},
 "risk": {"intro": "These runs look like they are heading for trouble. Start with the first one.", "empty_title": "Nothing looks risky", "empty_body": "No run is above the warning level right now.", "suggested": "Suggested next step:", "look": "Look into it",
          "why_show": "Why does it look risky?", "why_hide": "Hide the reasons", "summary_some": "{pct} of the serious warnings so far turned out to be right.", "summary_none": "Not enough warnings yet to say how reliable they are.",
          "reliability_show": "How reliable are the warnings?", "reliability_hide": "Hide", "rule_based": "This is a transparent, rule-based score, not a trained model. Early numbers rest on few runs, so treat them with care.",
          "kpi_right": "Warnings that came true", "kpi_right_sub": "{resolved} checked · {pending} still pending", "kpi_first": "Failures warned about first", "kpi_first_sub": "{n} failures", "kpi_lead": "Average head start", "kpi_lead_unit": "steps", "kpi_lead_none": "n/a",
          "kpi_false": "Needless alarms", "kpi_false_sub": "of {n} serious warnings", "history_title": "Warning history", "history_sub": "Every warning, and whether it turned out to be right", "history_empty": "Nothing recorded yet.",
          "cols": {"score": "Score", "problem": "Predicted problem", "run": "Run", "step": "Step", "confidence": "Confidence", "result": "What happened"}, "outcome": {"occurred": "✓ came true", "not_occurred": "✗ did not happen", "pending": "… run still going"},
          "built": "How this score was built", "score_label": "Risk {score} of 100", "level_score": "score {score}"},
 "trace": {"title": "Investigation", "sub": "What happened, where it went wrong, and what is safe to do next"},
 "shell": {"menu_open": "Open menu", "menu_close": "Close menu", "menu_title": "Menu", "sign_out": "Sign out", "local_mode": "Local mode: sign-in is off", "api_up": "Server connected", "api_down": "Server not reachable", "api_checking": "Checking…",
           "nav_label": "Main", "subnav_label": "Pages in this section", "profile_label": "Account menu", "my_account": "My account", "connection_settings": "Connection settings", "theme_label": "Colour theme", "theme": {"system": "Match my device", "light": "Light", "dark": "Dark"}, "skip": "Skip to content", "copy": "Copy", "copied": "Copied ✓", "error_prefix": "Something went wrong:", "loading": "Loading…", "retry": "Try again", "backend_down": "Can’t reach the server. Check that it is running, then refresh this page.", "waiting": "{n} waiting",
           "error_title": "Something went wrong on this page", "error_body": "Nothing was lost. Try again. If it keeps happening, tell your administrator.", "error_details": "Technical details", "brand": "AgentGuard"},
 "overview": {
  "welcome_title": "No activity yet. Connect an agent and send its first task.", "welcome_steps": ["Try a sample agent. It takes one click and needs no setup.", "Or connect your own agent. We will guide you step by step.", "Come back here to see how healthy your agents are."],
  "welcome_try": "Try a sample agent", "welcome_connect": "Connect my own agent", "welcome_demo": "Load demo data", "demo_loading": "Loading…", "demo_locked": "Ask a member or admin to get started.",
  "bands": [{"min_healthy": 0.8, "tone": "good", "text": "Your agents look healthy."}, {"min_healthy": 0.5, "tone": "warn", "text": "Some runs need attention."}, {"min_healthy": 0, "tone": "bad", "text": "Many runs have problems. Start with the most serious ones below."}],
  "tile_health": {"label": "Healthy runs", "sub": "{n} of {total} runs had no problems", "hint": "A run is healthy when none of AgentGuard’s checks found a problem in it."},
  "tile_attention": {"label": "Needs attention", "sub": "serious problems to look at", "hint": "Runs with a high or critical problem."},
  "tile_approvals": {"label": "Waiting for you", "sub": "actions paused until you decide", "hint": "An agent wanted to do something it is not allowed to do alone. It waits for a person to say yes or no."},
  "tile_stopped": {"label": "Stopped for safety", "sub": "risky actions blocked", "hint": "Actions a safety rule stopped before they could run."},
  "tile_agents": {"label": "Connected agents", "sub": "{n} registered", "hint": "Agents that have sent at least one real run to AgentGuard."},
  "tile_tasks": {"label": "Tasks completed", "sub": "of {total} recorded", "hint": "Runs that finished successfully. Demo and sample runs are never counted."},
  "tile_problems": {"label": "Problems needing attention", "sub": "high or critical", "hint": "Runs with a serious problem that nobody has resolved."},
  "tile_waiting": {"label": "Waiting for approval", "sub": "actions on hold", "hint": "An agent wants to do something it is not allowed to do alone. It waits for a person to say yes or no."},
  "health_title": "Agent health", "health_sub": "How each agent is doing", "health_empty": "Your agents haven’t been connected yet.", "health_all": "See all agents",
  "activity_title": "Recent activity", "activity_sub": "The latest tasks your agents worked on", "activity_empty": "No activity yet. Connect an agent and send its first task.", "activity_all": "See all activity",
  "outcome": {"succeeded": "Completed", "failed": "Failed", "blocked": "Stopped by a safety rule", "running": "Running", "unknown": "Unknown"}, "problem_flag": "{n} problem(s)", "no_problem_flag": "No problems",
  "next_title": "Suggested next steps", "next_sub": "Based on what has been recorded so far",
  "suggestions": {"connect_first_agent": {"text": "Connect your first agent so AgentGuard can start watching it.", "cta": "Connect an agent"}, "send_first_task": {"text": "Your agent is registered. Send its first task so AgentGuard can start checking it.", "cta": "See how"},
                  "review_approvals": {"text": "{n} action(s) are waiting for a person to decide.", "cta": "Review approvals"}, "review_problems": {"text": "{n} run(s) have a serious problem.", "cta": "Look at the problems"},
                  "create_safety_rule": {"text": "No safety rules are switched on yet, so nothing is being blocked. Add a rule to protect sensitive actions.", "cta": "Add a safety rule"}, "run_reliability_test": {"text": "Run your first reliability test to see how your agent performs.", "cta": "Run a test"},
                  "all_good": {"text": "Nothing needs your attention right now.", "cta": "Look at recent activity"}},
  "fix_title": "Fix these first", "fix_sub": "The most serious problems, newest first", "fix_empty": "Nothing urgent right now.", "fix_open": "Look into it", "fix_all": "See all problems",
  "more_show": "Show the full report", "more_hide": "Hide the full report", "more_note": "Charts and extra numbers for people who want the detail."},
 "connect": {
  "intro": "Choose how you want to start. You do not need to write any code to try AgentGuard.",
  "choices": [
   {"key": "try", "icon": "▶", "title": "Try it now", "body": "Run a pretend agent right here and watch AgentGuard react. Nothing to install.", "button": "Start"},
   {"key": "mine", "icon": "🧩", "title": "Connect my own agent", "body": "A guided path: get a key, download one small file, run it, and see your agent appear.", "button": "Start guide"},
   {"key": "dev", "icon": "👩‍💻", "title": "Ask a developer", "body": "Copy a ready-made message with everything a developer needs to connect a real agent.", "button": "Get the message"}],
  "back": "← Back to the choices", "back_step": "← Back", "next": "Continue →", "agent_label": "Agent name", "agent_hint": "A short name, for example support-agent. It appears on every run and report.", "agent_placeholder": "support-agent", "agent_default": "my-first-agent",
  "try": {"title": "Try a sample agent", "intro": "Pick a situation. AgentGuard will play it as if a real agent had just done it, and show what it noticed.", "run": "Run this sample", "running": "Running…",
          "found": "AgentGuard noticed {n} problem(s): {headline}", "clean": "AgentGuard checked the run and found nothing wrong, as it should.", "see": "See exactly what happened", "again": "Try another sample",
          "note": "Samples are simulated by AgentGuard and are clearly marked as samples. They are kept apart from your real activity and never change your numbers.", "view_demo": "View it in demo data", "locked": "Only members and admins can run samples."},
  "mine": {"title": "Connect my own agent", "steps": [
    {"key": "name", "title": "Name it", "body": "Give your agent a short name.", "button": "Register this agent", "done": "“{name}” is registered."},
    {"key": "key", "title": "Get a key", "body": "A key is like a password that lets your agent send its runs to AgentGuard. It cannot read your data.", "button": "Create my key", "once": "Copy this key now. It is shown only once.", "locked": "Only admins can create keys. Ask an admin to create one for you, then paste it below.", "paste_label": "Paste the key here", "paste_placeholder": "ag_…"},
    {"key": "file", "title": "Download the file", "body": "This small file already contains your agent’s name and key. It sends one sample run so you can check the connection.", "button": "Download my file", "need_key": "Create or paste a key first."},
    {"key": "run", "title": "Run it", "body": "You only need Python on your computer, once.", "python_title": "Step 1. Install Python (only once)", "python_body": "Go to python.org/downloads, download Python and open the installer. On the first screen, tick “Add python.exe to PATH”, then press Install.",
     "open_title": "Step 2. Open a terminal where the file is", "open_windows": "Windows: open the folder with the downloaded file, click the address bar at the top, type  powershell  and press Enter.", "open_mac": "Mac: open Terminal, type  cd Downloads  and press Enter.",
     "run_title": "Step 3. Run the file", "run_body": "Type this and press Enter:", "expect": "You should see “Done. AgentGuard received the sample run”. Then press the button below.", "next": "I ran it. Check the connection.",
     "trouble_title": "If something goes wrong", "trouble": [{"q": "It says “python is not recognized”", "a": "Python is not installed or was installed without “Add to PATH”. Run the installer again and tick that box."}, {"q": "It says “Could not reach AgentGuard”", "a": "The AgentGuard server must be running and reachable from this computer. Ask whoever set it up."}, {"q": "It says error 401", "a": "The key is wrong or was revoked. Go back and create a new key."}]},
    {"key": "check", "title": "Check", "waiting": "Waiting for the first run from “{name}”…", "waiting_hint": "This page checks by itself every few seconds.", "ok": "Connected. “{name}” has sent {n} run(s). (A test run does not count as real activity.)", "see": "See its runs", "again": "Check again", "next_title": "What next?", "next_body": "That file sent a sample. To connect your real agent, ask a developer: they can use the message from “Ask a developer”.", "dev": "Get the message for a developer"}]},
  "dev": {"title": "A message for your developer", "intro": "Copy this and send it. It has everything needed to connect a real agent. The key is added if you created one.", "copy": "Copy the message", "key_missing": "(create a key first, or ask an admin)",
          "template": "Hi! Please connect our agent “{agent}” to AgentGuard.\n\n1. Install the SDK:\n{install}\n\n2. Add this to the agent’s code:\n{snippet}\n\nServer address: {server}\nAPI key: {key}\n\nMark tools that move money, delete data or send messages as consequential, so AgentGuard can protect them. Docs: docs/SDK_GUIDE.md"},
  "agents_title": "Your agents", "agents_sub": "Everything already connected", "agents_empty": "No agents yet.", "keys_link": "Manage API keys →"},
 "activity": {"intro": "What your agents have been doing, newest first.", "filters": {"all": "All activity", "successful": "Successful tasks", "problems": "Problems", "blocked": "Blocked actions", "approvals": "Pending approvals"}, "filter_empty": "Nothing here matches this filter in the activity loaded so far. Load earlier activity to look further back.", "empty": "No activity yet. Connect an agent and send its first task.", "today": "Today", "yesterday": "Yesterday", "earlier_day": "Earlier", "details": "Details", "earlier": "Show earlier activity", "end": "That is all the recorded activity.",
              "icons": {"task_started": "▶", "task_completed": "✅", "task_failed": "❌", "problem_detected": "⚠", "action_blocked": "⛔", "approval_requested": "✋", "approval_decided": "🗳", "recovery_attempted": "🔄", "recovery_completed": "🩹"},
              "kinds": {"task_started": "{agent} started a task", "task_completed": "{agent} finished a task", "task_failed": "{agent}’s task did not succeed", "problem_detected": "Problem found: {category}", "action_blocked": "{agent}’s action “{tool}” was blocked", "approval_requested": "{agent} asked for approval to use “{tool}”",
                        "approval_decided": "Approval for “{tool}” was {status} by {by}", "recovery_attempted": "AgentGuard tried to recover {agent}’s run", "recovery_completed": "Recovery {result}"},
              "status": {"approved": "approved", "rejected": "rejected", "changes_requested": "sent back for changes", "expired": "left to expire"}, "recovery_ok": "worked", "recovery_failed": "did not work", "resolved": "resolved", "rule": "Rule: {rule}"},
 "problems": {"make_test": "Turn into a test", "test_title": "Make a test from this problem", "test_intro": "This saves a copy of the run as a test, so you can check that AgentGuard keeps catching it. All text is removed first; check what is kept below.", "test_kept": "Kept", "test_removed": "Removed", "test_catches": "The test expects AgentGuard to catch:", "test_not_preserved": "Cannot be tested from the copy (it depended on removed text): {list}", "test_none": "Nothing in this run can be tested once its text is removed.", "test_confirm": "I reviewed what the test keeps and removes", "test_save": "Save test", "test_saved": "Saved. Find it under Test Library → Your own tests.", "test_failed": "Could not save the test: {why}", "test_steps": "{n} steps", "occurrences": "Happened {n} times in this run", "intro": "Everything AgentGuard found, most serious first. Each problem explains what happened and what to do about it.", "tabs": {"critical": "Critical", "warning": "Warnings", "resolved": "Resolved"},
              "empty_none": "No problems have been detected in the recorded executions.", "empty_group": {"critical": "Nothing critical right now.", "warning": "No warnings.", "resolved": "Nothing has been marked as resolved yet."},
              "q": {"what": "What happened?", "why": "Why does it matter?", "agent": "Which agent was affected?", "did": "What did AgentGuard do?", "next": "What should you do next?"},
              "did": {"blocked": "It stopped the action “{tool}” before it ran (rule: {rule}).", "approval": "It held the action “{tool}” until a person approved it (rule: {rule}).", "recovery": "It tried to recover the run automatically.", "warned": "It warned about “{tool}” but let it continue (rule: {rule}).", "recorded": "It recorded the problem. No safety rule was set to stop it."},
              "confirmed": "Confirmed", "possible": "Possible risk", "confirmed_hint": "A rule checked this and it is a fact.", "possible_hint": "A pattern that usually means trouble. It could not be proven.",
              "evidence_show": "Show the evidence", "evidence_hide": "Hide the evidence", "open_run": "See the whole run", "resolve": "Mark as resolved", "reopen": "Reopen", "note_label": "What did you do? (optional)", "note_placeholder": "For example: fixed the tool, added a safety rule", "save": "Save", "cancel": "Cancel",
              "resolved_by": "Resolved by {who} {when}", "event_label": "Step: {id}", "rule_label": "Rule: {rule}", "agent_filter": "Showing problems for {agent}", "clear_filter": "Show all agents"},
 "safety": {"applies": "Applies to", "all_agents": "All agents", "only_these": "Only these agents", "none_registered": "No agents are connected yet, so this rule will apply to every agent.", "extra_label": "Another agent name", "extra_placeholder": "Agent name", "add": "Add", "scope_help": "Choose which agents this rule protects."},
 "agents": {"cols": {"agent": "Agent", "health": "Health", "runs": "Runs", "flagged": "Flagged", "blocked": "Blocked actions", "risk": "Average risk", "env": "Environment", "seen": "Last seen"}, "never": "never",
            "health": {"none": "No runs yet", "ok": "Healthy", "some": "Some problems", "attention": "Needs attention"},
            "stats": {"runs": "runs", "flagged": "flagged", "blocked": "blocked", "risk": "risk"}, "last_seen": "last seen {when}", "never_seen": "never seen", "open_label": "Open runs of {name}",
            "empty_title": "Your agents haven’t been connected yet.", "empty_body": "An agent appears here the first time it sends a run.", "empty_cta": "Connect your first agent", "count_one": "1 agent", "count_many": "{n} agents",
            "sub": "Click an agent to see its runs", "view_cards": "Cards", "view_table": "Table", "connect": "＋ Connect an agent",
            "integration_label": "Connected through", "integration": {"sdk": "Python SDK", "api": "Direct API", "starter_file": "Starter file (test only)", "sample": "Sample runs (simulated)", "none": "Not connected yet"},
            "connection": {"connected": {"label": "Connected", "hint": "Sent a real run in the last {days} days."}, "quiet": {"label": "Quiet", "hint": "Nothing received for {days} days or more."}, "test_only": {"label": "Test run only", "hint": "Only the connection test has arrived. No real task yet."}, "waiting": {"label": "Waiting for the first run", "hint": "Registered, but nothing has been received."}},
            "recent": "Recent activity", "recent_none": "No activity yet.", "problems_open": "{n} open problem(s)", "problems_none": "No open problems", "serious": "{n} serious"},
 "scenarios": {
  "title": "Practice situations", "sub": "Made-up agent runs we use to check that AgentGuard works",
  "intro": "Each card is one pretend situation. Some contain a real problem AgentGuard should catch. Others are perfectly normal, and AgentGuard should not raise an alarm. We score it on both, so it catches problems without crying wolf.",
  "note": "Click any card to see what happened, step by step. All of these are synthetic (made up for testing), not real customer data.",
  "technical_toggle": "Show technical details",
  "tabs": [{"key": "fail", "label": "Problems to catch", "show": "problem"}, {"key": "quiet", "label": "Normal runs", "show": "normal"}, {"key": "all", "label": "Everything", "show": "all"}],
  "search_label": "Search", "search_placeholder": "Type a word, e.g. refund or retry", "problem_filter_label": "Type of problem", "problem_filter_any": "Any problem",
  "empty": "Nothing matches", "no_problem_headline": "Nothing wrong here", "more_problems": "+{n} more",
  "should_quiet": "AgentGuard should stay quiet. No alarm expected.", "should_do": "AgentGuard should:",
  "strip_caption": "Each square is one step of the scripted run; red means a problem happened there and the ringed square is where it first becomes detectable.",
  "drawer": {"reference": "Reference", "steps": "What happened, step by step", "first_detectable": "First detectable", "find": "What AgentGuard should find",
             "find_nothing": "Nothing. This run is fine, so AgentGuard should stay quiet. Raising an alarm here counts as a false alarm.", "do": "What AgentGuard should do about it",
             "sim": "Test settings", "sim_note": "only used when testing automatic recovery", "sim_retries": "Failing retries before success", "sim_args": "Corrected arguments valid", "sim_evidence": "Extra evidence available",
             "yes": "yes", "no": "no", "hidden": "The expected answer above is hidden from the detectors during a benchmark; it is only used to grade them."},
  "add": {"summary": "Add your own scenario", "help": "Describe a scripted agent run and the answer you expect. The backend checks it before saving. The template below comes from the server.", "json_label": "Scenario JSON",
          "button": "Validate and add", "members_only": "Members and admins only", "ok": "Added. It will be included in the next benchmark run.", "fail": "Not saved: "}},
 "admin": {"intro": "The state of your workspace and who can do what.", "kpi_people": "People", "kpi_people_sub": "{n} active", "kpi_keys": "API keys", "kpi_keys_sub": "{n} in use", "kpi_rules": "Safety rules", "kpi_rules_sub": "{n} switched on",
           "kpi_retention": "Keep runs for", "kpi_retention_sub": "days", "security_title": "Recent security events", "security_sub": "Sign-ins, setting and rule changes", "security_empty": "No security events yet.", "security_cta": "Open the full log",
           "shortcuts_title": "Manage", "shortcut_team": "People and roles", "shortcut_keys": "API keys", "shortcut_settings": "Settings", "shortcut_rules": "Safety rules", "roles_title": "What each role can do", "db_title": "Database", "db_sub": "Where AgentGuard keeps everything", "db_engine": "Type", "db_schema": "Schema version", "db_size": "Size", "db_counts": "What is stored", "db_backup": "Download a backup", "db_backup_note": "A consistent copy of the database file, safe to take while AgentGuard is running. Keep it somewhere private: it contains your data.", "db_no_backup": "Automatic backup is only available for SQLite. For PostgreSQL, use pg_dump (see docs/DEPLOYMENT.md).", "db_backup_done": "Backup downloaded.", "db_unknown": "not recorded", "counts": {"agents": "Agents", "runs": "Runs", "events": "Steps recorded", "findings": "Problems found", "policies": "Safety rules", "approvals": "Approvals", "users": "People", "api_keys": "API keys", "audit_entries": "Log entries"}, "tidy_title": "Tidy up", "tidy_sub": "Remove what you no longer need", "cleanup": "Delete runs older than the keep-for setting", "cleanup_done": "Removed {n} old runs.",
           "roles_sub": "Changing a role takes effect the next time the person loads a page"},
}

# Wording that used to be written inside the React pages. One file, easy to read and edit: backend/app/ui_strings.json
from .test_wording import TESTS as _TESTS
UI["tests"] = _TESTS
UI["strings"] = json.loads((Path(__file__).with_name("ui_strings.json")).read_text(encoding="utf-8"))

def meta(role: str = "viewer") -> dict:
    return {"categories": CATEGORIES, "severities": SEVERITIES, "severity_colors": SEVERITY_COLORS, "risk_levels": RISK_LEVELS, "policy_actions": POLICY_ACTIONS, "modes": MODES, "roles": ROLES, "actions": ACTIONS, "metrics": METRICS,
            "access": access_for(role), "ui": UI, "sample_runs": [{k: v for k, v in x.items() if k != "failure"} for x in SAMPLE_RUNS]}
