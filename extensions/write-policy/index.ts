import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  isToolCallEventType,
  isWriteToolResult,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const DOC_EXTENSIONS = new Set([
  ".adoc",
  ".markdown",
  ".md",
  ".mdx",
  ".org",
  ".rst",
  ".tex",
  ".txt",
]);

const DOC_BASENAMES = new Set([
  "AGENTS",
  "CHANGELOG",
  "CLAUDE",
  "NOTES",
  "README",
  "TODO",
]);

function resolvePath(cwd: string, path: string): string {
  const normalized = path.startsWith("@") ? path.slice(1) : path;
  return resolve(cwd, normalized);
}

function mutationPathKey(path: string): string {
  const absolutePath = resolve(path);
  try {
    return realpathSync.native(absolutePath);
  } catch {
    return absolutePath;
  }
}

function isAppendableDocument(path: string): boolean {
  const base = basename(path);
  const root = base.split(".")[0].toUpperCase();
  return DOC_EXTENSIONS.has(extname(base).toLowerCase()) || DOC_BASENAMES.has(root);
}

export default function (pi: ExtensionAPI) {
  // A successful write that passed the new-file preflight can be rewritten later in the same session.
  const createdByWritePaths = new Set<string>();
  const pendingWriteCreations = new Map<string, string>();

  pi.on("session_start", async () => {
    createdByWritePaths.clear();
    pendingWriteCreations.clear();
  });

  pi.registerTool({
    name: "append",
    label: "Append",
    description: "Append content to an existing documentation/text file. Use write for new files and edit for precise changes.",
    promptSnippet: "Append content to existing documentation/text files",
    promptGuidelines: [
      "Use append to add sections to an existing document; use write only for new files or files created by write in this session.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to an existing documentation/text file" }),
      content: Type.String({ description: "Content to append" }),
    }),
    async execute(_id, { path, content }, _signal, _onUpdate, ctx) {
      const absolutePath = resolvePath(ctx.cwd, path);

      return withFileMutationQueue(absolutePath, async () => {
        if (!existsSync(absolutePath)) {
          return {
            content: [{ type: "text", text: `Error: ${path} does not exist. Use write to create new files.` }],
            details: { error: true },
            isError: true,
          };
        }
        if (!statSync(absolutePath).isFile()) {
          return {
            content: [{ type: "text", text: `Error: ${path} is not a regular file.` }],
            details: { error: true },
            isError: true,
          };
        }
        if (!isAppendableDocument(absolutePath)) {
          return {
            content: [{ type: "text", text: `Error: append is only for documentation/text files. Use edit for existing source files.` }],
            details: { error: true },
            isError: true,
          };
        }

        const current = await readFile(absolutePath, "utf-8");
        const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
        const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
        const addition = `${prefix}${content}${suffix}`;
        await writeFile(absolutePath, current + addition, "utf-8");

        return {
          content: [{ type: "text", text: `Appended ${addition.length} bytes to ${path}` }],
          details: { bytes: addition.length },
        };
      });
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("write", event)) return;

    const path = event.input.path;
    if (typeof path !== "string" || path.length === 0) return;

    const absolutePath = resolvePath(ctx.cwd, path);
    const key = mutationPathKey(absolutePath);
    if (createdByWritePaths.has(key)) return;
    if (!existsSync(absolutePath)) {
      pendingWriteCreations.set(event.toolCallId, absolutePath);
      return;
    }

    return {
      block: true,
      reason: [
        "write is only for new files or files created by write in this session.",
        "Use edit for precise existing-file changes, or append to add sections to an existing document.",
      ].join(" "),
    };
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!isWriteToolResult(event)) return;

    const pendingPath = pendingWriteCreations.get(event.toolCallId);
    pendingWriteCreations.delete(event.toolCallId);
    if (event.isError) return;

    const path = pendingPath ??
      (typeof event.input.path === "string" ? resolvePath(ctx.cwd, event.input.path) : undefined);
    if (!path) return;

    createdByWritePaths.add(mutationPathKey(path));
  });
}
