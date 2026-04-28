---
name: task-decomposition
type: workflow
triggers: ["/decompose"]
when_to_use: when the task has multiple unknowns or clearly requires multi-step reasoning
context: inline
token_cost: 75
user_invocable: false
---
Before tool calls, write:

GIVEN: <prompt facts>
UNKNOWN: <1-2 items to find out>
PLAN:
  1. <first tool action>
  2. <next>
  3. <answer>

Resolve unknowns one at a time. After each tool call, strike resolved items or revise the plan.
