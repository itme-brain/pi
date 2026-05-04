import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { assessResponse, buildCorrectionMessage, type ToolCall } from "./quality.ts";

// Hooks turn_end, inspects the assistant message + previous turn's tool calls,
// and steers a correction user message into the next LLM call when a failure
// mode is detected.

let previousToolCalls: ToolCall[] = [];
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_CORRECTIONS = 2; // stop nudging after 2 failed corrections

export default function (pi: ExtensionAPI) {
  // Seed from Pi's registry so the first use of a valid tool is not flagged as
  // unknown if execution is interrupted before we observe lifecycle events.
  const knownTools = new Set<string>();
  const refreshKnownTools = (): void => {
    for (const tool of pi.getAllTools()) knownTools.add(tool.name);
  };

  pi.on("session_start", async () => {
    refreshKnownTools();
    previousToolCalls = [];
    consecutiveFailures = 0;
  });

  pi.on("before_agent_start", async () => {
    refreshKnownTools();
  });

  pi.on("tool_execution_start", async (event) => {
    const name = (event as any).toolName;
    if (typeof name === "string") knownTools.add(name);
  });

  pi.on("turn_end", async (event, ctx) => {
    const message = (event as any).message;
    if (!message) return;

    // Extract assistant text + tool calls from pi's content-block format
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("\n");
    const currentCalls: ToolCall[] = content
      .filter((c: any) => c?.type === "toolCall")
      .map((c: any) => ({ name: c.name, input: c.arguments ?? c.input ?? {} }));

    const verdict = assessResponse(text, currentCalls, previousToolCalls, knownTools);

    // Update rolling state for next turn regardless of verdict
    previousToolCalls = currentCalls;

    if (verdict.ok) {
      consecutiveFailures = 0;
      return;
    }

    // Cap corrections so we don't burn turns in a correction loop
    consecutiveFailures++;
    if (consecutiveFailures > MAX_CONSECUTIVE_CORRECTIONS) {
      ctx.ui.notify(
        `quality-monitor: ${verdict.reason} (suppressed after ${consecutiveFailures} in a row)`,
        "warning",
      );
      return;
    }

    const correction = buildCorrectionMessage(verdict.reason);
    ctx.ui.notify(
      `quality-monitor: ${verdict.reason}: steering correction`,
      "warning",
    );
    pi.sendUserMessage(correction, { deliverAs: "steer" });
  });
}
