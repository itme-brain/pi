---
name: read-guidance
type: tool-guidance
target_tool: Read
priority: 10
user-invocable: false
---
Read an absolute file path with numbered lines. For large files, use `limit` and
zero-based `offset` for focused chunks of roughly 100–200 lines. Output is
`line_number<TAB>content`.
