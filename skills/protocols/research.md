---
name: research
type: workflow
triggers: ["/research"]
when_to_use: when the task requires gathering facts from the web and citing them in a final answer
context: inline
token_cost: 100
user_invocable: false
---
1. Decompose: write 1-2 specific unknowns. If more than 2, split the task.
2. For each unknown: search → extract a URL only if the snippet is not enough.
3. Every factual claim cites a URL. End with "Sources:".
4. Before answering, paste the exact snippet that produced each citation. No snippet → no citation.

Resolve one unknown fully before the next. Never invent URLs. Narrow the query if search returns nothing useful.
