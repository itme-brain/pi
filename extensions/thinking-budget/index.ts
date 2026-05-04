import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hiddenSteer } from "../quality-monitor/steer.ts";

// Implements between-turn fallback for thinking-budget cap:
//   1. Count thinking_delta tokens during message_update
//   2. On budget exceed, call ctx.abort() to end the turn
//   3. On turn_end after abort, flip thinking to "off" and steer the model
//      to commit to an implementation for one recovery turn

const DEFAULT_BUDGET = 2048;

// Per-turn rolling state
let thinkingChars = 0;
let budgetForTurn = DEFAULT_BUDGET;
let aborted = false;
let restoreThinkingLevel: any = null;
let recoveryStarted = false;

function charsToTokens(chars: number): number {
  // Matches local/context_manager.estimate_tokens (len/3.5)
  return Math.ceil(chars / 3.5);
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const opts: any = (event as any).systemPromptOptions ?? {};
    const lc = opts.littleCoder ?? {};
    const profileBudget = Number(lc.thinkingBudget);
    const envBudget = Number(process.env.LITTLE_CODER_THINKING_BUDGET);
    budgetForTurn =
      (Number.isFinite(profileBudget) && profileBudget > 0 && profileBudget) ||
      (Number.isFinite(envBudget) && envBudget > 0 && envBudget) ||
      DEFAULT_BUDGET;
  });

  pi.on("turn_start", async () => {
    thinkingChars = 0;
    aborted = false;
  });

  pi.on("message_update", async (event, ctx) => {
    const ev: any = (event as any).assistantMessageEvent;
    if (!ev) return;
    if (ev.type !== "thinking_delta") return;
    const delta = typeof ev.delta === "string" ? ev.delta : "";
    thinkingChars += delta.length;
    if (aborted) return;
    const tokens = charsToTokens(thinkingChars);
    if (tokens > budgetForTurn) {
      aborted = true;
      restoreThinkingLevel = pi.getThinkingLevel();
      ctx.ui.notify(
        `thinking-budget: ${tokens} > ${budgetForTurn}: aborting turn, will retry with thinking off`,
        "warning",
      );
      ctx.abort();
    }
  });

  pi.on("turn_end", async (_event, _ctx) => {
    if (!aborted) return;
    aborted = false;
    recoveryStarted = false;
    pi.setThinkingLevel("off");
    hiddenSteer(
      pi,
      "thinking-budget",
      "Thinking budget exceeded. Commit to an implementation now; stop deliberating and use tools to make progress.",
    );
  });

  pi.on("message_start", async (event) => {
    if (!restoreThinkingLevel) return;
    const message = (event as any).message;
    if (message?.role === "assistant") recoveryStarted = true;
  });

  pi.on("agent_end", async () => {
    if (!restoreThinkingLevel || !recoveryStarted) return;
    pi.setThinkingLevel(restoreThinkingLevel);
    restoreThinkingLevel = null;
    recoveryStarted = false;
  });
}
