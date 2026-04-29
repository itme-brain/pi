---
name: glob-guidance
type: tool-guidance
target_tool: glob
priority: 8
token_cost: 35
user-invocable: false
---
Use glob/find to discover files by path pattern before reading. Prefer narrow patterns and avoid recursively inspecting large generated, vendor, or binary-heavy trees.
