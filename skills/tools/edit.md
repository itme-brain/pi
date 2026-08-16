---
name: edit-guidance
type: tool-guidance
target_tool: Edit
priority: 10
user-invocable: false
---
Use Edit for targeted changes to an existing file. Read the file first. Each
`oldText` must match exactly, including whitespace and line endings, and must be
unique—include surrounding lines when needed. Batch disjoint edits in one
`edits` array; entries match the original file, so they must not overlap or
nest. Delete text with an empty `newText`.

On “String not found,” reread and copy the exact text. On “Found multiple
times,” add surrounding context. Use Write instead when replacing the entire
file is clearer; the same read-first rule applies.
