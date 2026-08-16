// Port of local/quality.py::assess_response + build_correction_message.

export interface ToolCall {
  name: string;
  input: unknown;
}

export type QualityResult =
  | { ok: true }
  | { ok: false; reason: string };

// Tools that mutate state the environment then depends on. If the previous turn
// ran one of these *alongside* a repeated call, re-issuing that call is
// legitimate progress, not a loop — e.g. Edit a source file, then re-run the
// same build command (issue #81). Bash/ShellSession count because a shell
// command can change anything; matching is by lowercased tool name.
const STATE_CHANGING_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "bash",
  "shellsession",
]);

export function assessResponse(
  text: string,
  toolCalls: ToolCall[],
  recentToolCalls: ToolCall[],
  knownTools: Set<string>,
): QualityResult {
  // 1. Empty response with no tool calls
  if (!text.trim() && toolCalls.length === 0) {
    return { ok: false, reason: "empty_response" };
  }

  // 2. Hallucinated tool names (only checked when registry populated)
  for (const tc of toolCalls) {
    if (!tc.name) return { ok: false, reason: "empty_tool_name" };
    if (knownTools.size > 0 && !knownTools.has(tc.name)) {
      return { ok: false, reason: `unknown_tool:${tc.name}` };
    }
  }

  // 3. Repeated tool call loop (exact name+input match with previous turn).
  //    A verbatim repeat is only a loop when nothing could have changed the
  //    outcome. If the previous turn ran a state-changing tool *other than* the
  //    repeated call itself (e.g. an Edit next to a re-run build command), the
  //    environment plausibly changed, so re-issuing the call is progress — not a
  //    loop (issue #81).
  if (toolCalls.length > 0 && recentToolCalls.length > 0) {
    for (const tc of toolCalls) {
      const tcInput = JSON.stringify(tc.input);
      for (const prev of recentToolCalls) {
        if (tc.name === prev.name && JSON.stringify(prev.input) === tcInput) {
          const envChanged = recentToolCalls.some((r) => {
            const isRepeatedCall =
              r.name === tc.name && JSON.stringify(r.input) === tcInput;
            return !isRepeatedCall && STATE_CHANGING_TOOLS.has(r.name.toLowerCase());
          });
          if (envChanged) continue;
          return { ok: false, reason: "repeated_tool_call" };
        }
      }
    }
  }

  // 4. Malformed arguments sentinel from repairJson fallback
  for (const tc of toolCalls) {
    if (tc.input && typeof tc.input === "object" && "_raw" in tc.input) {
      return { ok: false, reason: `malformed_args:${tc.name || "?"}` };
    }
  }

  return { ok: true };
}

export function buildCorrectionMessage(reason: string): string {
  const corrections: Record<string, string> = {
    empty_response: "No response produced. Continue the task.",
    empty_tool_name: "Blocked: tool name is empty. Use an available tool.",
    repeated_tool_call: "Blocked: identical tool call repeated. Use a different action.",
  };

  if (reason.startsWith("unknown_tool:")) {
    const toolName = reason.slice("unknown_tool:".length);
    return `Blocked: tool '${toolName}' does not exist. Use an available tool.`;
  }
  if (reason.startsWith("malformed_args:")) {
    const toolName = reason.slice("malformed_args:".length);
    return `Blocked: invalid JSON arguments for ${toolName}. Retry with valid JSON.`;
  }

  return corrections[reason] ?? `Blocked: ${reason}. Use a different action.`;
}

// Short, user-facing phrasing for the harness-intervention line.
export function phraseForUser(reason: string): string {
  if (reason.startsWith("unknown_tool:")) {
    return `the model called a tool that doesn't exist (${reason.slice("unknown_tool:".length)})`;
  }
  if (reason.startsWith("malformed_args:")) {
    return `the model's tool arguments were malformed (${reason.slice("malformed_args:".length)})`;
  }
  const phrases: Record<string, string> = {
    empty_response: "the model returned an empty response",
    empty_tool_name: "the model emitted a tool call with no name",
    repeated_tool_call: "the model repeated its previous tool call verbatim",
  };
  return phrases[reason] ?? `quality issue (${reason})`;
}
