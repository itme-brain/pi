---
name: api-symbols
type: domain-knowledge
token_cost: 70
keywords: [implement, install, import, use, library, package, framework, module, api, function, class, method, hook, component]
requires_tools: [glob, grep, read]
user-invocable: false
---
Before using an external library or API: never guess at signatures.

1. Search the installed package for actual exports (type defs, source, entry points). Read only what you need.
2. Web search as fallback when not installed locally.

Be specific — glob by package name, do not dump packages into context.
