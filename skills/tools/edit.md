---
name: edit-guidance
type: tool-guidance
target_tool: Edit
priority: 10
user-invocable: false
---
Use Edit for every change to an existing file; Write is only for new files.
Read first. Each `oldText` must match exactly, including whitespace and line
endings, and must be unique—include 2–3 surrounding lines when needed. Batch
disjoint edits in one `edits` array; entries match the original file, so they
must not overlap or nest. Delete text with an empty `newText`.

On “String not found,” reread and copy the exact text. On “Found multiple
times,” add surrounding context. Never recover from an Edit failure by
rewriting the existing file with Write.
