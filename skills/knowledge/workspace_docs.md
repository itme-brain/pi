---
name: workspace-docs
type: domain-knowledge
topic: Workspace Documentation
token_cost: 100
keywords: [implement, build, create, fix, task, exercise, feature, todo, spec, specification, requirements, instructions, bug, test, failing, review, refactor]
requires_tools: [read, glob]
user-invocable: false
---
Before non-trivial code work, check for a workspace spec — these often contain format rules and edge cases tests assert.

Priority order:
- `.docs/instructions.md` (and `.append.md`)
- `AGENTS.md` / `CLAUDE.md`
- `README.md`
- `SPEC.md` / `SPECIFICATION.md`
- `docs/*.md`

Use glob to discover, read the relevant one. Once per task. Skip for read-only questions.
