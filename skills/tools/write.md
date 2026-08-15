---
name: write-guidance
type: tool-guidance
target_tool: Write
priority: 10
user-invocable: false
---
Use Write only to create a new file from its exact path and complete content;
parent directories are created automatically. Existing files are refused—do
not retry or bypass the refusal. Use Edit for every modification, including
bug fixes, refactors, formatting, additions, and post-test iterations.

To replace an existing file completely, read it and use Edit with the entire
current content as `oldText`. Never use placeholder paths.
