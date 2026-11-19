"""Builds the one-file starter agent a non-technical person can download and run.

It needs only Python itself (no packages, no SDK): it sends one clearly-labelled sample run to AgentGuard so the person can see the
connection work end to end. Real agents are connected with the SDK by a developer; the wizard hands over a ready message for that.
"""
STARTER_TEMPLATE = '''"""AgentGuard starter agent for "{agent}".

This file sends ONE sample run to AgentGuard so you can see the connection work.
It uses only Python's built-in tools. Nothing here changes anything on your computer.
Run it with:   python {filename}
"""
import json, sys, time, urllib.error, urllib.request, uuid
from datetime import datetime, timezone

SERVER = "{server}"
API_KEY = "{key}"
AGENT = "{agent}"

trace = "starter-" + uuid.uuid4().hex[:10]
steps = [
    ("run_start", None, None, None, "ok"),
    ("tool_call", "look_up_order", {{"order_id": "A-1001"}}, None, "ok"),
    ("tool_result", "look_up_order", {{"order_id": "A-1001"}}, {{"status": "delivered"}}, "ok"),
    ("run_end", None, None, None, "ok"),
]
events = []
for i, (kind, tool, args, out, status) in enumerate(steps):
    events.append({{"trace_id": trace, "run_id": trace, "event_id": f"e{{i}}", "agent_name": AGENT, "event_type": kind,
                   "timestamp": datetime.now(timezone.utc).isoformat(), "step_index": i, "tool_name": tool,
                   "tool_input": args, "tool_output": out, "status": status, "metadata": {{"starter": True}}}})

request = urllib.request.Request(SERVER.rstrip("/") + "/api/v1/traces", method="POST",
    data=json.dumps({{"trace_id": trace, "events": events}}).encode(),
    headers={{"Content-Type": "application/json", "Authorization": "Bearer " + API_KEY}})
try:
    with urllib.request.urlopen(request, timeout=15) as reply:
        print("Done. AgentGuard received the sample run (" + str(json.load(reply).get("accepted", "?")) + " steps).")
        print("Go back to the AgentGuard page: it should say Connected.")
except urllib.error.HTTPError as problem:
    print("AgentGuard answered with an error:", problem.code, problem.read().decode()[:300]); sys.exit(1)
except OSError as problem:
    print("Could not reach AgentGuard at", SERVER, "-", problem); sys.exit(1)
'''

def starter_file(agent: str, server: str, key: str) -> dict:
    """`key` may be a placeholder; the page fills in the real one in the browser so it never travels through the server twice."""
    name = "".join(c if c.isalnum() or c in "-_" else "-" for c in agent).strip("-") or "my-agent"
    filename = f"agentguard_{name}.py"
    return {"filename": filename, "content": STARTER_TEMPLATE.format(agent=agent.replace('"', ""), server=server, key=key, filename=filename)}
