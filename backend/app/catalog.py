"""Plain-English metadata used by the API and UI so nothing shows up as an unexplained identifier."""
CATEGORIES = {
 "invalid_tool_arguments": {"label": "Invalid tool arguments", "why": "The agent called a tool with inputs that break the tool's declared schema, so the call fails or does the wrong thing.", "fix": "Validate arguments against the schema before calling; correct and retry only if the tool is read-only."},
 "tool_execution_failure": {"label": "Tool failed", "why": "A tool returned an error. Transient errors may be retried; permanent ones need a different approach.", "fix": "Retry (bounded, read-only tools only) for transient errors; otherwise escalate."},
 "repeated_failures": {"label": "Stuck in a retry loop", "why": "The same tool failed the same way several times in a row. More retries waste time and can cause side effects.", "fix": "Stop and escalate to a human."},
 "unauthorized_action": {"label": "Action without approval", "why": "A consequential action (money, deletion, messages) ran without a prior, matching human approval.", "fix": "Block the action and request explicit approval."},
 "unsupported_success_claim": {"label": "False success claim", "why": "The agent reported success while a tool's latest result was still an unresolved error.", "fix": "Mark the run failed and escalate."},
 "incomplete_execution": {"label": "Run never finished", "why": "The trace has no end event. The agent may have crashed, been abandoned, or still be running.", "fix": "Wait, or mark the run abandoned."},
 "missing_required_evidence": {"label": "Missing required evidence", "why": "The run ended without successfully calling a tool the task required, so the conclusion is unsupported.", "fix": "Gather the missing evidence before concluding."},
 "contradictory_tool_results": {"label": "Contradictory results", "why": "Two successful results about the same entity disagree, so at least one is wrong or stale.", "fix": "Request more evidence to resolve the conflict."},
 "workflow_invariant_violation": {"label": "Steps out of order", "why": "A step that must come after another (e.g. refund after identity check) happened first.", "fix": "Stop and escalate; the required order was not followed."},
 "goal_constraint_violation": {"label": "Task limit exceeded", "why": "A tool input went beyond a limit set for this task (for example a refund above the allowed amount).", "fix": "Block and request human approval."},
}
CATEGORIES.update({
 "repeated_tool_calls": {"label": "Repeated calls", "why": "The agent keeps making the same successful call again and again, wasting time and money and hiding that it is stuck.", "fix": "Stop and replan; reuse the earlier result."},
 "infinite_loop": {"label": "Going in circles", "why": "The agent repeats the same sequence of steps, or keeps getting identical answers, without making progress.", "fix": "Stop the run and replan with different information."},
 "resource_exhaustion": {"label": "Budget exceeded", "why": "The run used more tool calls, tokens, cost or time than its limit allows.", "fix": "Stop the run and review why it needed so much."},
 "sensitive_data_exposure": {"label": "Sensitive data exposed", "why": "Personal or secret data was sent to an external tool or included in the agent's final answer.", "fix": "Block the action and require approval; remove the data."},
 "prompt_injection_indicator": {"label": "Possible prompt injection", "why": "Content the agent received from a tool contains instruction-like text that could try to take control of the agent.", "fix": "Treat the content as untrusted data and review the next actions."},
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
 "user_created": "User created", "user_updated": "User updated", "password_reset": "Password reset by admin", "api_key_created": "API key created", "api_key_revoked": "API key revoked",
 "settings_updated": "Settings changed", "policy_created": "Policy created", "policy_updated": "Policy updated", "policy_toggled": "Policy switched on/off", "approval_decided": "Approval decision", "workspace_created": "Workspace created", "api_key_rotated": "API key rotated", "recovery_proposed": "Recovery proposed", "recovery_reported": "Recovery result recorded", "scenario_from_trace": "Scenario created from a run", "regression_run": "Regression suite run", "retention_run": "Old data cleaned up", "benchmark_started": "Benchmark run", "recovery_simulated": "Recovery simulated",
 "scenario_added": "Scenario added", "demo_seeded": "Demo data loaded", "ai_diagnosis_requested": "AI diagnosis requested",
}
SECURITY_ACTIONS = {"policy_created", "policy_updated", "policy_toggled", "workspace_created", "api_key_rotated", "setup_completed", "login", "login_failed", "logout", "password_changed", "user_created", "user_updated", "password_reset", "api_key_created", "api_key_revoked", "settings_updated", "retention_run"}
ROLES = [
 {"key": "viewer", "label": "Viewer", "plain": "Can look at everything but change nothing."},
 {"key": "member", "label": "Member", "plain": "Can also run benchmarks and simulations, load demo data, add scenarios and send traces."},
 {"key": "admin", "label": "Admin", "plain": "Can also manage people, API keys and settings, and see the security history."},
]
RISK_LEVELS = [{"key": "low", "min": 0}, {"key": "medium", "min": 25}, {"key": "high", "min": 50}, {"key": "critical", "min": 75}]
POLICY_ACTIONS = {"ALLOW": "Let it run", "WARN": "Let it run, but warn", "DEFER": "Hold until more information arrives", "REQUIRE_APPROVAL": "A human must approve first", "BLOCK": "Stop it before it runs"}
MODES = {"observe": "Only watch and record. Nothing is ever stopped.", "warn": "Warn about problems but never stop anything.", "enforce": "Stop actions that policies forbid and wait for required approvals."}
def meta(): return {"categories": CATEGORIES, "severities": SEVERITIES, "severity_colors": SEVERITY_COLORS, "risk_levels": RISK_LEVELS, "policy_actions": POLICY_ACTIONS, "modes": MODES, "roles": ROLES, "actions": ACTIONS, "metrics": METRICS}
