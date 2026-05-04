import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { glob } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Type } from "typebox";
import { hiddenSteer } from "../_shared/steer.ts";

const MAX_GLOB_RESULTS = 80;

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
          matches.push(relative(ctx.cwd, resolve(base, m)) || ".");
          if (matches.length >= MAX_GLOB_RESULTS) break;
        }
        matches.sort();
        if (matches.length >= MAX_GLOB_RESULTS) {
          hiddenSteer(
            pi,
            "broad-glob",
            "The glob matched many files. Narrow by directory, extension, or symbol before reading.",
          );
        }
        return {
          content: [
            {
              type: "text",
              text: matches.length === 0
                ? "No files matched."
                : matches.join("\n") +
                  (matches.length >= MAX_GLOB_RESULTS ? `\n[glob: stopped after ${MAX_GLOB_RESULTS} matches]` : ""),
            },
          ],
          details: { count: matches.length, files: matches, truncated: matches.length >= MAX_GLOB_RESULTS },
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
