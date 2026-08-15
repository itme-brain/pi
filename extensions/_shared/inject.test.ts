import { describe, expect, it } from "vitest";
import { injectionResult, makeDedupe } from "./inject.ts";

describe("injectionResult", () => {
  it("returns a hidden tail message and never touches the system prompt", () => {
    const result = injectionResult("lc-skills", "GUIDANCE");
    expect(result).toEqual({
      message: { customType: "lc-skills", content: "GUIDANCE", display: false },
    });
    // This is the whole point of #73: the cached prefix must be left alone.
    expect(result?.systemPrompt).toBeUndefined();
  });

  it("returns undefined for an empty block", () => {
    expect(injectionResult("lc-skills", "")).toBeUndefined();
  });
});

describe("makeDedupe", () => {
  it("suppresses a block identical to the previous one", () => {
    const should = makeDedupe();
    expect(should("A")).toBe(true);
    expect(should("A")).toBe(false); // still in the conversation from last turn
    expect(should("B")).toBe(true);
    expect(should("B")).toBe(false);
    expect(should("A")).toBe(true); // changed away and back — must be re-sent
  });

  it("keeps separate state per injector", () => {
    const skills = makeDedupe();
    const knowledge = makeDedupe();
    expect(skills("A")).toBe(true);
    expect(knowledge("A")).toBe(true); // not shadowed by skill-inject's state
  });
});
