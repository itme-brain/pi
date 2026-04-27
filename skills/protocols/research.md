---
name: research
type: workflow
triggers: ["/research"]
when_to_use: when the task requires gathering facts from the web and citing them in a final answer
context: inline
token_cost: 200
user_invocable: false
---
## Research Protocol

When the task requires facts you don't already have, follow this loop. Don't skip steps.

### 1. Decompose
Before searching, write down 1–2 specific unknowns. If there are more than 2, split the task.

```
UNKNOWN: <one specific question>
```

### 2. Search → Extract
For each unknown:
1. Call `mcp` with the `web-search` server's `search` tool to find candidate sources.
2. If a result snippet is enough, stop there.
3. If you need the full page, call `extract` on the URL.

### 3. Cite
Every factual claim in your answer must reference the URL it came from. No URL → don't state it as fact. End with a "Sources:" list, one URL per fact.

### 4. Verify before answering
Before producing the final answer, for each URL you plan to cite, paste the exact tool call result snippet (from `search` or `extract`) that produced it. If you can't produce the snippet, you can't cite the URL.

### Rules
- **One unknown at a time.** Resolve it fully before moving to the next.
- **Don't paraphrase a snippet without verifying.** If ambiguous, extract.
- **No hallucinated URLs.** Only cite URLs returned by the tools.
- **If search returns nothing useful**, narrow the query or try a different one before giving up.
