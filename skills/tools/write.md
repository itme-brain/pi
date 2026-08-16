---
name: write-guidance
type: tool-guidance
target_tool: Write
priority: 10
user-invocable: false
---
Use Write with an exact path and complete file content. New files are allowed
immediately; parent directories are created automatically. Before replacing an
existing file, Read it in the current session. After that, either Write or Edit
is allowed. Never use placeholder paths.
