---
name: read-guidance
type: tool-guidance
target_tool: read
priority: 10
token_cost: 60
user-invocable: false
---
Read a file with line numbers (format: "N\tline"). Always use absolute paths. For large files, paginate with limit+offset in 100-200 line chunks. Never read whole log files — they flood context. Use Grep to find lines, then read a small window.
