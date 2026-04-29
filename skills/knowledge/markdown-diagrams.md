---
name: markdown-diagrams
type: domain-knowledge
topic: Markdown Diagrams
token_cost: 90
keywords: [markdown, diagram, diagrams, chart, charts, architecture, flowchart, graph, boxes, box, documentation, docs, subsystem, subsystems]
requires_tools: [edit]
user-invocable: false
---
For Markdown diagrams, prefer Mermaid (`flowchart`, `sequenceDiagram`, `graph`) or Markdown tables/lists over hand-aligned box art.

Avoid Unicode box-drawing for complex architecture diagrams; it breaks under wrapping, proportional fonts, and mixed-width characters. If plain text art is explicitly needed, use a fenced code block, ASCII-only characters, short labels, fixed line widths, and verify every row has the same width.
