---
name: bash-guidance
type: tool-guidance
target_tool: bash
priority: 10
token_cost: 40
user-invocable: false
---
Stateless — `cd` does not persist. Use absolute paths or chain with `&&`. Default timeout 30s; pass timeout=120-300 for installs/builds.
