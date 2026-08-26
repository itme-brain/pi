---
name: bash-guidance
type: tool-guidance
target_tool: Bash
user-invocable: false
---
Execute shell commands and read combined stdout/stderr. Calls are stateless; use
absolute paths. Default timeout: 30 seconds; use 120–300 seconds for installs,
downloads, and builds.
