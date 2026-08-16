import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { harnessIntervention } from "../_shared/intervention.ts";
import { knownFiles } from "../_shared/known-files.ts";
import { detectWriteTargets } from "../_shared/shell-write.ts";

// Windows reserved device names. Writing to a file whose basename is one of
// these (with or without an extension, any case) targets a DOS device rather
// than a real file on Windows, leaving an undeletable junk file behind — and
// it's essentially always a mistake elsewhere too (the model treating `nul`
// like `/dev/null`; issue #60). We block it on every platform so a POSIX run
// can't author a file that's a landmine the moment the repo is cloned on
// Windows.
const RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * True when `filePath`'s final segment is a Windows reserved device name.
 * The check is case-insensitive and ignores any extension (`NUL.txt` and
 * `com1.log` are reserved too — Windows resolves them to the device).
 */
export function isReservedDeviceName(filePath: string): boolean {
  const base = basename(filePath).toLowerCase();
  const stem = base.includes(".") ? base.slice(0, base.indexOf(".")) : base;
  return RESERVED_DEVICE_NAMES.has(stem);
}

/**
 * Resolve a write `path` argument to a concrete on-disk path.
 *
 * Two deterministic rewrites:
 *
 * 1. `"/<single-segment>"` (e.g. `/foo.md`) → `<cwd>/<single-segment>`.
 *    Background: the model has been seen to anchor at filesystem root when
 *    given an "Absolute file path" schema and no obvious directory context.
 *    Genuine system-path writes always include at least one intermediate
 *    directory (`/etc/X`, `/tmp/Y/Z`), so a root + bare filename is almost
 *    always a mistake. Rewriting to cwd matches user intent and avoids
 *    accidentally writing to `/`.
 *
 * 2. Bare filename / relative path (no leading slash) → resolved against cwd.
 *
 * Anything else (absolute path with at least one intermediate directory) is
 * left untouched.
 */
export function normalizeWritePath(
  filePath: string,
  cwd: string = process.cwd(),
): { path: string; rewrittenFrom?: string } {
  if (/^\/[^/]+$/.test(filePath)) {
    return { path: join(cwd, filePath.slice(1)), rewrittenFrom: filePath };
  }
  if (!isAbsolute(filePath)) {
    return { path: join(cwd, filePath) };
  }
  return { path: filePath };
}

// Read whichever key carries the destination path. pi's built-in `write` uses
// `path`; older little-coder builds and some prompts use `file_path`. We accept
// both so the guard is independent of which write implementation is in play.
function pathKey(input: Record<string, unknown>): "path" | "file_path" | undefined {
  if (typeof input.path === "string") return "path";
  if (typeof input.file_path === "string") return "file_path";
  return undefined;
}

// Tools that hand a string to a shell, and so can reach the filesystem without
// going anywhere near the `write` tool (issue #70).
const SHELL_TOOLS = new Set(["bash", "Bash", "ShellSession"]);

function readBeforeOverwriteReason(resolved: string): string {
  return `Blocked: ${resolved} already exists and has not been read this session. Read it, then retry Write or use Edit.`;
}

// The earlier implementation registered a *custom* `write`
// tool to enforce this — but pi ships its own built-in `write`
// (`core/tools/write.js`, "overwrites if it does") which shadowed the custom
// one, so on current pi the guard never fired and existing files were silently
// rewritten. We now enforce at the `tool_call` event instead, which fires for
// whichever `write` implementation runs and lets us both normalize the path in
// place and block the call before it executes.
/** A refusal, or null when the destination is fine to write. */
export interface WriteVerdict {
  reason: string;
  /** What to surface on the single "harness intervention: …" line. */
  intervention: string;
}

/**
 * Decide whether `resolved` (an already-normalized absolute path) may be
 * written. Shared by the `write` tool and the shell guard so both refuse the
 * same destinations for the same reasons.
 *
 * @param truncates whether the operation replaces existing content. A shell
 *   append (`>>`) doesn't destroy anything, so it is allowed without a prior
 *   read; a reserved device name is still refused either way.
 */
export function writeVerdict(
  resolved: string,
  truncates = true,
  hasBeenRead = false,
): WriteVerdict | null {
  // Reserved Windows device name (nul, con, com1, …): refuse outright. On
  // Windows this would create an undeletable device-named file (issue #60);
  // everywhere it's a near-certain mistake. Check before existsSync — a
  // reserved name should never be written regardless.
  if (isReservedDeviceName(resolved)) {
    return {
      intervention: `blocked a write to the reserved device name "${basename(resolved)}".`,
      reason: `Blocked: "${basename(resolved)}" is a reserved Windows device name. Choose another filename.`,
    };
  }

  if (!truncates) return null; // append — nothing is lost
  if (!existsSync(resolved)) return null; // new file — allow it through
  if (hasBeenRead) return null; // informed replacement — allow either Write or Edit

  return {
    intervention: "the model tried to overwrite an unread file — redirected it to Read first.",
    reason: readBeforeOverwriteReason(resolved),
  };
}

// Intercept pi's built-in Write so an existing file must be read before it can
// be replaced. The earlier implementation registered a *custom* `write`
// tool to enforce this — but pi ships its own built-in `write`
// (`core/tools/write.js`, "overwrites if it does") which shadowed the custom
// one, so on current pi the guard never fired and existing files were silently
// rewritten. We now enforce at the `tool_call` event instead, which fires for
// whichever `write` implementation runs and lets us both normalize the path in
// place and block the call before it executes.
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (String((event as any).toolName ?? "").toLowerCase() !== "write") return;
    const input = ((event as any).input ?? {}) as Record<string, unknown>;
    const key = pathKey(input);
    if (!key) return;

    const { path: resolved } = normalizeWritePath(String(input[key]), ctx.cwd);
    // Normalize in place so the executing write (built-in or custom) lands on
    // the resolved path even when we don't block (e.g. the `/foo.md` → cwd fix).
    input[key] = resolved;

    const verdict = writeVerdict(resolved, true, knownFiles.has(resolved));
    if (!verdict) return;
    harnessIntervention(ctx, verdict.intervention);
    return { block: true, reason: verdict.reason };
  });

  // Issue #70: the same guarantee, for the shell. `write` being refused pushed
  // models straight to `cat > file << 'EOF'`, which reached the identical bytes
  // through a tool the guard never looked at — rvanswieten hit it 5x in one
  // session (main.py x3, App.jsx, pyproject.toml).
  //
  // In auto/manual permission mode, permission-gate refuses shell writes before
  // this ever runs. In accept-all mode (benchmarks) it doesn't, so this is the
  // layer that applies the same read-before-overwrite policy there.
  pi.on("tool_call", async (event, ctx) => {
    if (!SHELL_TOOLS.has(String((event as any).toolName ?? ""))) return;
    const cmd = ((event as any).input ?? {})?.command;
    if (typeof cmd !== "string" || !cmd) return;

    for (const write of detectWriteTargets(cmd)) {
      const { path: resolved } = normalizeWritePath(write.path, ctx.cwd);
      const verdict = writeVerdict(
        resolved,
        write.kind !== "append",
        knownFiles.has(resolved),
      );
      if (!verdict) continue;
      harnessIntervention(ctx, verdict.intervention);
      return {
        block: true,
        reason: isReservedDeviceName(resolved)
          ? verdict.reason
          : `Blocked: this command overwrites unread file ${resolved}. Read it, then retry.`,
      };
    }
  });
}
