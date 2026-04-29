---
name: bash-guidance
type: tool-guidance
target_tool: bash
priority: 10
token_cost: 35
user-invocable: false
---
Bash is stateless: directory changes do not persist between calls. Prefer absolute paths, or keep dependent shell steps in one command. Use longer timeouts for builds, tests, and installs.
