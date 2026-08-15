---
name: grep-guidance
type: tool-guidance
target_tool: Grep
priority: 8
user-invocable: false
---
Search file contents with ripgrep regex and return matching paths, line numbers,
and text. Use `literal: true` for plain text, `glob` to restrict file types,
`ignoreCase` for case-insensitive search, and `context` for nearby lines.
Search a focused `path` and set `limit` when results may be broad (default 100).
