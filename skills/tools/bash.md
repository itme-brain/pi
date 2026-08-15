---
name: bash-guidance
type: tool-guidance
target_tool: Bash
priority: 10
user-invocable: false
---
Execute shell commands and read combined stdout/stderr. Calls are stateless, so
`cd` does not persist: use absolute paths or `cd /path && command` in one call.
The default timeout is 30 seconds; use 120–300 seconds for installs, downloads,
and builds.
