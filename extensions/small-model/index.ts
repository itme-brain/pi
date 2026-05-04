import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { hiddenSteer, isHiddenSteerMessage } from "./steer.ts";

const LARGE_FILE_BYTES = 50 * 1024;
const TOOL_RESULT_CHAR_LIMIT = 6000;
const CONTEXT_TOOL_RESULT_CHAR_LIMIT = 2000;
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

let guardSteersThisPrompt = 0;
let inspectionStreak = 0;
let inspectionSteered = false;
let needsVerification = false;
let verificationSteered = false;
let deliveredHiddenSteers = new Set<string>();
const errorCounts = new Map<string, number>();

function textContentLength(content: any): number {
  if (!Array.isArray(content)) return typeof content === "string" ? content.length : 0;
  return content.reduce((sum, part) => sum + (part?.type === "text" ? String(part.text ?? "").length : 0), 0);
}

function trimTextContent(content: any, limit: number): any {
  if (!Array.isArray(content)) return content;

  let remaining = limit;
  let truncated = false;
  const next = [];
  for (const part of content) {
    if (part?.type !== "text") {
      next.push(part);
      continue;
    }
    const text = String(part.text ?? "");
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    if (text.length <= remaining) {
      next.push(part);
      remaining -= text.length;
      continue;
    }
    next.push({ ...part, text: text.slice(0, remaining) });
    remaining = 0;
    truncated = true;
  }

  if (truncated) {
    next.push({
      type: "text",
      text: `\n[small-model: tool output truncated to ${limit} characters; narrow the query if more detail is needed]`,
    });
  }
  return next;
}

function steerOnce(pi: ExtensionAPI, reason: string, content: string): void {
  if (guardSteersThisPrompt >= MAX_GUARD_STEERS_PER_PROMPT) return;
  guardSteersThisPrompt++;
  hiddenSteer(pi, reason, content);
}

function errorAdvice(toolName: string): string {
  switch (toolName) {
    case "read":
      return "The read tool failed repeatedly. Search for the exact symbol or path first, then read a small offset/limit window.";
    case "edit":
      return "The edit tool failed repeatedly. Read the exact surrounding lines, then make one precise edit.";
    case "bash":
      return "The bash tool failed repeatedly. Check cwd, command availability, and the smallest reproducible command before retrying.";
    default:
      return `The ${toolName} tool failed repeatedly. Change approach before retrying the same call.`;
  }
}

function isLargeRead(input: any, cwd: string): string | null {
  const path = typeof input?.path === "string" ? input.path : "";
  if (!path) return null;
  const absolute = resolve(cwd, path.startsWith("@") ? path.slice(1) : path);
  if (!existsSync(absolute)) return null;
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const ext = extname(absolute).toLowerCase();
  const limit = typeof input.limit === "number" ? input.limit : undefined;
  const isLog = ext === ".log" || ext === ".out" || ext === ".err";
  if ((isLog || stat.size > LARGE_FILE_BYTES) && limit === undefined) {
    return `${relative(cwd, absolute)} is ${stat.size} bytes. Search first, or read a small offset/limit window.`;
  }
  return null;
}

function hiddenSteerKey(message: any): string {
  return `${message.timestamp ?? ""}:${message.content ?? ""}`;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    guardSteersThisPrompt = 0;
    inspectionStreak = 0;
    inspectionSteered = false;
    needsVerification = false;
    verificationSteered = false;
    deliveredHiddenSteers = new Set<string>();
    errorCounts.clear();
  });

  pi.on("before_agent_start", async () => {
    guardSteersThisPrompt = 0;
    inspectionStreak = 0;
    inspectionSteered = false;
  });

  pi.on("tool_call", async (event, ctx) => {
    if ((event as any).toolName !== "read") return;
    const reason = isLargeRead((event as any).input, ctx.cwd);
    if (!reason) return;
    return { block: true, reason };
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

    if (textContentLength((event as any).content) <= TOOL_RESULT_CHAR_LIMIT) return;
    steerOnce(pi, "large-output", "A tool returned broad output. Narrow the query instead of consuming more context.");
    return {
      content: trimTextContent((event as any).content, TOOL_RESULT_CHAR_LIMIT),
      details: { ...(((event as any).details ?? {}) as object), smallModelTruncated: true },
    };
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

      if (message?.role === "toolResult" && textContentLength(message.content) > CONTEXT_TOOL_RESULT_CHAR_LIMIT) {
        changed = true;
        return [{ ...message, content: trimTextContent(message.content, CONTEXT_TOOL_RESULT_CHAR_LIMIT) }];
      }

      return [message];
    });

    if (!changed) return;
    return { messages: result };
  });
}
