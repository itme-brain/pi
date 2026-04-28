import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "glob",
    label: "Glob",
    description: "Find files by glob pattern.",
    parameters: Type.Object({
      pattern: Type.String({ description: "e.g. **/*.py" }),
      path: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const base = params.path ? resolve(ctx.cwd, params.path) : ctx.cwd;
        const matches: string[] = [];
        for await (const m of glob(params.pattern, { cwd: base })) {
          matches.push(resolve(base, m));
          if (matches.length >= 500) break;
        }
        matches.sort();
        return {
          content: [
            {
              type: "text",
              text: matches.length === 0 ? "No files matched." : matches.join("\n"),
            },
          ],
          details: { count: matches.length, files: matches },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });
}
