import { describe, it, expect } from "vitest";
import setupExtension, { budgetForThinkingLevel } from "./index.ts";

// Exercise the char→token conversion (matches local/context_manager.py)
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 3.5);
}

describe("thinking budget token estimation", () => {
  it("converts chars to tokens via /3.5", () => {
    expect(charsToTokens(0)).toBe(0);
    expect(charsToTokens(3)).toBe(1);
    expect(charsToTokens(7)).toBe(2);
    expect(charsToTokens(3500)).toBe(1000);
  });
  it("4096 tokens ~ 14336 chars (the v1.5.0 default budget)", () => {
    expect(charsToTokens(14336)).toBe(4096);
    expect(charsToTokens(14337)).toBeGreaterThan(4096);
  });
});

describe("thinking-level budget mapping", () => {
  const qwenMap = {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "xhigh",
    xhigh: null,
    max: null,
  } as const;

  it("uses caps for the effective Qwen effort", () => {
    expect(budgetForThinkingLevel("low", qwenMap)).toBe(512);
    expect(budgetForThinkingLevel("medium", qwenMap)).toBe(2048);
  });

  it("treats pi high as unbounded because it maps to Qwen xhigh", () => {
    expect(budgetForThinkingLevel("high", qwenMap)).toBe(Infinity);
  });

  it("does not budget thinking when it is off", () => {
    expect(budgetForThinkingLevel("off", qwenMap)).toBe(Infinity);
  });
});

// ── Issue #8 regression coverage (second reproduction, 1.4.3) ───────────────
// The bug: recovery (setThinkingLevel("off") + sendUserMessage) was deferred to
// a `turn_end` handler that ran against the module-scope `pi` AFTER ctx.abort()
// triggered a session replacement → stale `pi` → throw → thinking never turned
// off + follow-up never sent.
//
// The fix: do the whole recovery synchronously in `message_update`, BEFORE
// ctx.abort(), while `pi` is still live. These tests pin that choreography:
//   - no `turn_end` handler exists (nothing can run against a stale pi),
//   - setThinkingLevel + sendUserMessage are ordered strictly before abort,
//   - thinking is re-asserted off across the restart turn,
//   - the prior level is restored on the next genuine user input.

interface Handler {
  (event: any, ctx: any): Promise<unknown> | unknown;
}

function makeHarness(initialLevel = "low") {
  const calls: string[] = []; // ordered log across pi + ctx
  const followUps: string[] = [];
  const notifies: string[] = [];
  let level = initialLevel;
  const handlers: Record<string, Handler[]> = {};
  const pi = {
    handlers,
    on(name: string, h: Handler) {
      (handlers[name] ??= []).push(h);
    },
    getThinkingLevel() {
      return level;
    },
    setThinkingLevel(l: string) {
      level = l;
      calls.push(`set:${l}`);
    },
    sendUserMessage(m: string) {
      followUps.push(m);
      calls.push("send");
    },
  };
  const ctx = {
    abort() {
      calls.push("abort");
    },
    ui: {
      notify(m: string) {
        notifies.push(m);
        calls.push("notify");
      },
    },
  };
  return {
    pi,
    ctx,
    calls,
    followUps,
    notifies,
    level: () => level,
    setLevelExternally: (l: string) => {
      level = l;
    },
  };
}

async function fire(pi: any, name: string, event: any, ctx: any) {
  for (const h of pi.handlers[name] ?? []) await h(event, ctx);
}

function thinkingDelta(s: string) {
  return { assistantMessageEvent: { type: "thinking_delta", delta: s } };
}

// Always begin from a clean session — resets the extension's module-scoped
// state so cases don't leak `forcedOff` / `priorLevel` into one another (and
// mirrors real startup: session_start always precedes the first agent run).
async function startRun(h: ReturnType<typeof makeHarness>) {
  await fire(h.pi, "session_start", {}, h.ctx);
  await fire(h.pi, "agent_start", {}, h.ctx);
  await fire(h.pi, "before_agent_start", { systemPromptOptions: {} }, h.ctx);
  await fire(h.pi, "turn_start", {}, h.ctx);
}

describe("thinking-budget recovery (issue #8)", () => {
  it("registers NO turn_end handler (recovery must not run against a stale pi)", () => {
    const h = makeHarness();
    setupExtension(h.pi as any);
    expect(h.pi.handlers["turn_end"]).toBeUndefined();
  });

  it("on breach, runs the full recovery BEFORE abort and exactly once", async () => {
    const h = makeHarness();
    setupExtension(h.pi as any);
    await startRun(h);

    await fire(h.pi, "message_update", thinkingDelta("x".repeat(2000)), h.ctx);

    // setThinkingLevel("off") and sendUserMessage both happen before abort.
    expect(h.calls).toEqual(["set:off", "send", "notify", "abort"]);
    expect(h.level()).toBe("off");
    expect(h.followUps).toHaveLength(1);
    expect(h.followUps[0]).toMatch(/thinking budget exceeded/i);
    expect(h.notifies[0]).toMatch(/harness intervention:.*thought long enough/i);
  });

  it("does not double-abort across multiple bursts in the same turn", async () => {
    const h = makeHarness();
    setupExtension(h.pi as any);
    await startRun(h);
    await fire(h.pi, "message_update", thinkingDelta("x".repeat(2000)), h.ctx);
    await fire(h.pi, "message_update", thinkingDelta("y".repeat(2000)), h.ctx);
    await fire(h.pi, "message_update", thinkingDelta("z".repeat(2000)), h.ctx);

    expect(h.calls.filter((c) => c === "abort")).toHaveLength(1);
    expect(h.followUps).toHaveLength(1);
  });

  it("does not fire under budget", async () => {
    const h = makeHarness();
    setupExtension(h.pi as any);
    await startRun(h);
    await fire(h.pi, "message_update", thinkingDelta("ok"), h.ctx);
    expect(h.calls).toEqual([]);
    expect(h.level()).toBe("low");
  });

  it("re-asserts thinking off on the restart turn even if pi re-enables it", async () => {
    const h = makeHarness();
    setupExtension(h.pi as any);
    await startRun(h);
    await fire(h.pi, "message_update", thinkingDelta("x".repeat(2000)), h.ctx); // breach → off

    // Simulate the post-abort session replacement re-resolving thinking to the
    // profile default. The bug was that this stuck; the fix re-asserts off.
    h.setLevelExternally("high");
    await fire(h.pi, "agent_start", {}, h.ctx); // restart run after the followUp
    await fire(h.pi, "before_agent_start", { systemPromptOptions: {} }, h.ctx);
    await fire(h.pi, "turn_start", {}, h.ctx);

    expect(h.level()).toBe("off");
  });

  it("restores the prior thinking level on the next genuine user input", async () => {
    const h = makeHarness("medium");
    setupExtension(h.pi as any);
    await startRun(h);
    await fire(h.pi, "message_update", thinkingDelta("x".repeat(8000)), h.ctx); // breach
    expect(h.level()).toBe("off");

    // A new user prompt ends the forced-off window and restores the level.
    await fire(h.pi, "input", { text: "next task" }, h.ctx);
    expect(h.level()).toBe("medium");

    // And the force is cleared: a subsequent turn does NOT re-disable thinking.
    await fire(h.pi, "turn_start", {}, h.ctx);
    expect(h.level()).toBe("medium");
  });

  it("a fresh task (no prior breach) is never forced off", async () => {
    const h = makeHarness("low");
    setupExtension(h.pi as any);
    await fire(h.pi, "input", { text: "task" }, h.ctx);
    await startRun(h);
    await fire(h.pi, "message_update", thinkingDelta("ok"), h.ctx);
    expect(h.level()).toBe("low");
    expect(h.calls).toEqual([]);
  });
});

describe("thinking-budget resolution", () => {
  it("uses the model mapping when resolving the active turn", async () => {
    const h = makeHarness("high");
    (h.ctx as any).model = {
      thinkingLevelMap: { high: "xhigh" },
    };
    setupExtension(h.pi as any);
    await fire(h.pi, "session_start", {}, h.ctx);
    await fire(h.pi, "agent_start", {}, h.ctx);
    await fire(h.pi, "before_agent_start", {}, h.ctx);
    await fire(h.pi, "turn_start", {}, h.ctx);
    await fire(h.pi, "message_update", thinkingDelta("x".repeat(20000)), h.ctx);
    expect(h.calls).toEqual([]);
  });
});
