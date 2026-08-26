---
name: read-guidance
type: tool-guidance
target_tool: Read
user-invocable: false
---
Read a known absolute path; use Glob to find files and Grep to search contents.
For large files, use `limit` and zero-based `offset` for 100–200-line chunks.
Output is `line_number<TAB>content`.
