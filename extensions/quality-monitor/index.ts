import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { assessResponse, buildCorrectionMessage, type ToolCall } from "./quality.ts";
import { hiddenSteer, isHiddenSteerMessage } from "./steer.ts";

// Hooks turn_end, inspects the assistant message + previous turn's tool calls,
// and steers hidden correction context when a failure mode or dead-end is detected.

const MAX_CONSECUTIVE_CORRECTIONS = 2; // stop nudging after 2 failed corrections
const MAX_GUARD_STEERS_PER_PROMPT = 4;

const INSPECTION_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "glob",
  "file_symbols",
  "search_symbols",
  "symbol_info",
  "symbol_source",
  "project_overview",
]);
const MUTATION_TOOLS = new Set(["edit", "write", "append"]);

let previousToolCalls: ToolCall[] = [];
let consecutiveFailures = 0;
let guardSteersThisPrompt = 0;
let inspectionStreak = 0;
let inspectionSteered = false;
let needsVerification = false;
let verificationSteered = false;
let deliveredHiddenSteers = new Set<string>();
const errorCounts = new Map<string, number>();

function steerOnce(pi: ExtensionAPI, reason: string, content: string): void {
  if (guardSteersThisPrompt >= MAX_GUARD_STEERS_PER_PROMPT) return;
  guardSteersThisPrompt++;
  hiddenSteer(pi, reason, content);
}

function errorAdvice(toolName: string): string {
  switch (toolName) {
    case "read":
      return "The read tool failed repeatedly. Check the path, offset, or surrounding search before retrying.";
    case "edit":
      return "The edit tool failed repeatedly. Read the exact surrounding lines, then make one precise edit.";
    case "bash":
      return "The bash tool failed repeatedly. Check cwd, command availability, and the smallest reproducible command before retrying.";
    default:
      return `The ${toolName} tool failed repeatedly. Change approach before retrying the same call.`;
  }
}

function hiddenSteerKey(message: any): string {
  return `${message.timestamp ?? ""}:${message.content ?? ""}`;
}

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
    guardSteersThisPrompt = 0;
    inspectionStreak = 0;
    inspectionSteered = false;
    needsVerification = false;
    verificationSteered = false;
    deliveredHiddenSteers = new Set<string>();
    errorCounts.clear();
  });

  pi.on("before_agent_start", async () => {
    refreshKnownTools();
    guardSteersThisPrompt = 0;
    inspectionStreak = 0;
    inspectionSteered = false;
  });

  pi.on("tool_execution_start", async (event) => {
    const name = (event as any).toolName;
    if (typeof name === "string") knownTools.add(name);
  });

  pi.on("turn_end", async (event, ctx) => {
    const message = (event as any).message;
    if (!message) return;
    if (message.role === "assistant" && message.stopReason === "aborted") {
      consecutiveFailures = 0;
      return;
    }

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
    hiddenSteer(pi, `quality:${verdict.reason}`, correction);
  });

  pi.on("tool_result", async (event, _ctx) => {
    const toolName = (event as any).toolName;
    const isError = (event as any).isError === true;

    if (isError) {
      const count = (errorCounts.get(toolName) ?? 0) + 1;
      errorCounts.set(toolName, count);
      if (count === 2) steerOnce(pi, `tool-error:${toolName}`, errorAdvice(toolName));
    } else {
      errorCounts.delete(toolName);
    }

    if (MUTATION_TOOLS.has(toolName) && !isError) {
      needsVerification = true;
      verificationSteered = false;
      inspectionStreak = 0;
    } else if (toolName === "bash" && !isError && needsVerification) {
      needsVerification = false;
      verificationSteered = false;
    } else if (INSPECTION_TOOLS.has(toolName)) {
      inspectionStreak++;
      if (inspectionStreak >= 5 && !inspectionSteered) {
        inspectionSteered = true;
        steerOnce(
          pi,
          "inspection-loop",
          "You have inspected several times in a row. Make the smallest safe change, run a targeted check, or state the blocker.",
        );
      }
    }
  });

  pi.on("agent_end", async () => {
    if (!needsVerification || verificationSteered) return;
    verificationSteered = true;
    steerOnce(
      pi,
      "verify-after-change",
      "You changed files. Run one targeted verification command, or explicitly state that no relevant test/check exists.",
    );
  });

  pi.on("context", async (event) => {
    const messages = (event as any).messages;
    if (!Array.isArray(messages)) return;

    let changed = false;
    const result = messages.flatMap((message: any) => {
      if (isHiddenSteerMessage(message)) {
        const key = hiddenSteerKey(message);
        if (deliveredHiddenSteers.has(key)) {
          changed = true;
          return [];
        }
        deliveredHiddenSteers.add(key);
      }

      if (message?.role === "assistant" && Array.isArray(message.content)) {
        const content = message.content.filter((part: any) => part?.type !== "thinking");
        if (content.length !== message.content.length) {
          changed = true;
          return [{ ...message, content }];
        }
      }

      return [message];
    });

    if (!changed) return;
    return { messages: result };
  });
}
