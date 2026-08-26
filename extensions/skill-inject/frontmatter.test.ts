import { describe, it, expect } from "vitest";
import { parseSkillFile } from "./frontmatter.ts";

describe("parseSkillFile", () => {
  it("parses basic tool-guidance frontmatter", () => {
    const text = `---
name: read-guidance
type: tool-guidance
target_tool: Read
user-invocable: false
---
## Read Tool
Body content here.`;
    const p = parseSkillFile(text);
    expect(p).not.toBeNull();
    expect(p!.frontmatter.name).toBe("read-guidance");
    expect(p!.frontmatter.target_tool).toBe("Read");
    expect(p!.body.startsWith("## Read Tool")).toBe(true);
  });

  it("parses knowledge frontmatter with keyword arrays", () => {
    const text = `---
name: bfs-state-space
type: domain-knowledge
topic: State-Space Search
keywords: [bucket, pouring, state space, minimum moves, shortest sequence]
---
When a problem asks for minimum moves.`;
    const p = parseSkillFile(text);
    expect(p).not.toBeNull();
    expect(p!.frontmatter.topic).toBe("State-Space Search");
    expect(p!.frontmatter.keywords).toEqual([
      "bucket", "pouring", "state space", "minimum moves", "shortest sequence",
    ]);
  });

  it("parses requires_tools arrays", () => {
    const text = `---
name: api-symbols
topic: API Symbols
keywords: [api, library]
requires_tools: [Glob, Grep, Read]
---
body`;
    const p = parseSkillFile(text);
    expect(p!.frontmatter.requires_tools).toEqual(["Glob", "Grep", "Read"]);
  });

  it("returns null on missing frontmatter", () => {
    expect(parseSkillFile("no frontmatter here")).toBeNull();
  });

  it("handles body with multiple --- separators", () => {
    const text = `---
name: x
topic: X
---
body line 1
---
body line 2`;
    const p = parseSkillFile(text);
    expect(p).not.toBeNull();
    // Body should preserve everything after the closing ---
    expect(p!.body).toContain("body line 1");
    expect(p!.body).toContain("body line 2");
  });
});
