---
name: edit-guidance
type: tool-guidance
target_tool: edit
priority: 10
token_cost: 135
user-invocable: false
---
Replace exact text. Default tool for any change to an existing file — Write is for new files only.

- old_string must match EXACTLY (whitespace, indentation, line endings).
- old_string must be unique unless replace_all=true; include 2-3 lines of context.
- To delete: new_string="".
- Read the file first if you do not already have its current text.

On failure: re-read, fix old_string, retry. Do not fall back to Write.
- "Not found" → whitespace likely differs; re-read for exact text.
- "Found multiple times" → add more surrounding context for uniqueness.
