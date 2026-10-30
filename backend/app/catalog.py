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
SEVERITIES = ["low", "medium", "high", "critical"]
SEV_RANK = {s: i + 1 for i, s in enumerate(SEVERITIES)}
ACTIONS = {
 "none": {"label": "No action needed", "plain": "Nothing actionable was found, so AgentGuard leaves the run alone."},
 "retry": {"label": "Retry safely", "plain": "A transient failure on a read-only tool: retry with a small, bounded number of attempts."},
 "correct_args": {"label": "Fix the arguments", "plain": "Correct the inputs against the tool schema and retry once (read-only tools only)."},
 "request_evidence": {"label": "Ask for more evidence", "plain": "Gather the missing or conflicting information before the agent concludes."},
 "escalate": {"label": "Hand to a human", "plain": "Unsafe to continue automatically. A person must approve or take over."},
 "stop": {"label": "Stop the run", "plain": "Repeating further is unsafe. Halt and investigate."},
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
def meta(): return {"categories": CATEGORIES, "severities": SEVERITIES, "actions": ACTIONS, "metrics": METRICS}
