import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Port of tools.py::_write. Preserves the exact Edit-recipe error string so
// the model recovers to Edit on its next turn. The whitepaper's benchmark
// result depends on Write refusing whole-file rewrites of existing files
// (fires on ~57% of Polyglot exercises).
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "write",
    label: "Write",
    description:
      "Create a NEW file with the given content. Refuses if the file already exists — use edit to modify existing files. Parent directories are created automatically.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Absolute file path" }),
      content: Type.String({ description: "Full file content" }),
    }),
    async execute(_id, { file_path, content }) {
      if (existsSync(file_path)) {
        const recipe =
          `Error: write refused — ${file_path} exists. Use edit:\n` +
          `  {"name": "edit", "input": {"file_path": "${file_path}", "old_string": "...", "new_string": "..."}}\n` +
          `Read the file first if you do not have its current content. Do NOT retry write.`;
        return {
          content: [{ type: "text", text: recipe }],
          details: {},
          isError: true,
        };
      }

      try {
        mkdirSync(dirname(file_path), { recursive: true });
        writeFileSync(file_path, content, { encoding: "utf-8" });
        const lc = content.split("\n").length - (content.endsWith("\n") ? 1 : 0) +
          (content.length > 0 && !content.endsWith("\n") ? 1 : 0);
        return {
          content: [{ type: "text", text: `Created ${file_path} (${lc} lines)` }],
          details: {},
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
