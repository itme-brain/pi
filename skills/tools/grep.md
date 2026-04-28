---
name: grep-guidance
type: tool-guidance
target_tool: grep
priority: 8
token_cost: 50
user-invocable: false
---
Regex search via ripgrep. Use `include` to scope by file type instead of grepping the whole tree. For triage, prefer one broad alternation (e.g. `panic|error|fail`) over many narrow searches.
