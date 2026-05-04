import {
  createReadToolDefinition,
  DEFAULT_MAX_BYTES,
  formatSize,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { homedir } from "node:os";

function resolveForGuard(cwd: string, path: string): string {
  const withoutAt = path.startsWith("@") ? path.slice(1) : path;
  const expanded = withoutAt === "~"
    ? homedir()
    : withoutAt.startsWith("~/")
      ? homedir() + withoutAt.slice(1)
      : withoutAt;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function largeReadReason(input: any, cwd: string): string | null {
  if (!input || typeof input.path !== "string" || input.path.length === 0) return null;
  if (typeof input.limit === "number") return null;

  const absolute = resolveForGuard(cwd, input.path);
  if (!existsSync(absolute)) return null;

  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const ext = extname(absolute).toLowerCase();
  const isLog = ext === ".log" || ext === ".out" || ext === ".err";
  if (!isLog && stat.size <= DEFAULT_MAX_BYTES) return null;

  return `${relative(cwd, absolute) || input.path} is ${formatSize(stat.size)}. Search first, or call read with offset and limit.`;
}

export default function (pi: ExtensionAPI) {
  const baseRead = createReadToolDefinition(process.cwd());

  pi.registerTool({
    ...baseRead,
    description: `${baseRead.description} Logs and files over ${formatSize(DEFAULT_MAX_BYTES)} require offset/limit or a narrower search first.`,
    promptGuidelines: [
      ...(baseRead.promptGuidelines ?? []),
      `Use read with offset and limit for logs or files over ${formatSize(DEFAULT_MAX_BYTES)}; search first when unsure.`,
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const reason = largeReadReason(params, ctx.cwd);
      if (reason) {
        return {
          content: [{ type: "text", text: `Read blocked: ${reason}` }],
          details: { blocked: true, reason: "large-read" },
          isError: true,
        };
      }

      return createReadToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
