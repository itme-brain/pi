---
name: api-symbols
type: tool-guidance
target_tool: Glob
priority: 10
token_cost: 200
keywords: [implement, install, import, use, library, package, framework, module, api, function, class, method, hook, component]
requires_tools: [Glob, Grep, Read]
user-invocable: false
---
Before implementing anything that uses an external library or API — never guess at signatures or available exports.

Investigate in this order:
1. **Installed source/types** — search the local package for its actual exports (type definitions, source files, entry points). Read only what you need.
2. **Web search** — fallback when not installed locally or inspection is inconclusive. Use `mcp` with web-search to find official docs.

Be specific: glob by package name, read only the relevant files. Don't dump entire packages into context.
