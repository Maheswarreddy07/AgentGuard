# SDK guide

```bash
pip install -e sdk          # no third-party dependencies
```

```python
from agentguard import AgentGuard, ToolCallBlocked, ApprovalRejected, ApprovalTimeout

guard = AgentGuard(api_url="http://localhost:8000", api_key="ag_...", mode="enforce")   # observe | warn | enforce

@guard.tool("get_order", read_only=True)
def get_order(order_id): ...

@guard.tool("issue_refund", consequential=True)
def issue_refund(order_id, amount): ...

with guard.trace(agent_name="support-agent", task="Refund ORD-101",
                 required_tools=["get_order"],
                 must_precede=[["get_order", "issue_refund"]],
                 constraints=[{"tool": "issue_refund", "field": "amount", "max": 100}],
                 budget={"max_tool_calls": 20, "max_cost_usd": 0.50}) as run:
    order = run.tools.get_order(order_id="ORD-101")
    try:
        run.tools.issue_refund(order_id="ORD-101", amount=40)
    except ToolCallBlocked as e:            # the function did NOT run
        print(e.reason)
    run.finish(claimed_success=True)
```

## What happens on every `run.tools.x(...)`
1. Buffered events are sent. 2. The SDK asks `POST /api/v1/runtime/check` *before* calling your function. 3. The server evaluates policies and risk and writes a `policy_check` event. 4. If allowed, the SDK records `tool_call`, runs your function, records `tool_result`. If not allowed it raises and your function is never called.
`REQUIRE_APPROVAL` makes the SDK wait (polling) for a human; it then records a `human_approval` event and re-checks with the approval id. The server only accepts an approval that matches this run, tool and arguments, is approved, unexpired and unused, and then consumes it.

## Modes
- **observe** — decisions are recorded, nothing is stopped. **warn** — same, but marked as warnings. **enforce** — forbidden actions raise and approvals are awaited.
- If AgentGuard is unreachable: enforce **fails closed** (the tool is not run), observe/warn **fail open**. Override with `fail_mode="open"|"closed"`.

## Low-level API (when you cannot wrap tools)
```python
run = guard.start_trace("order-agent", "Check order status")
run.record_tool_call("get_order", {"order_id": "ORD-101"}, read_only=True)
run.record_tool_result("success", {"status": "shipped"})
run.finish(claimed_success=True)
```
This only records; it cannot prevent anything, because AgentGuard never sees the call before it happens.

## `run_agent`
`run.run_agent(agent)` calls `agent(task, tools)` (or `agent.run(task, tools)`) and records how it ended. A returned `dict` with `success` / `response`, or a `str`, is taken as the agent's own claim. Exceptions are recorded and re-raised.

## Not included yet
LangChain / LangGraph adapters, and recovery hooks (retry / correct arguments / replan callbacks).
