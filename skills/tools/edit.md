---
name: edit-guidance
type: tool-guidance
target_tool: edit
priority: 10
token_cost: 70
user-invocable: false
---
Use `edit` for exact small replacements.

- Read target lines first.
- Copy `oldText` verbatim; keep it small and unique.
- On failure, re-read; don’t retry stale text.
- Use `bash` for broad mechanical rewrites.
