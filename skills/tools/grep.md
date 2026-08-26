---
name: grep-guidance
type: tool-guidance
target_tool: Grep
user-invocable: false
---
Search file contents; use Glob for filenames. Uses ripgrep regex and returns
paths, line numbers, and text. Use `literal` for plain text, `glob` to filter
files, `ignoreCase` to fold case, and `context` for nearby lines. Use a focused
`path` and bound broad results with `limit` (default 100).
