import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { harnessIntervention } from "../_shared/intervention.ts";

// Files read or authored in this session. Keeping this state in the same
// extension that enforces both Edit and Write avoids cross-extension module
// isolation producing separate registries.
export const knownFiles = new Set<string>();

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
  // Tool implementations do not all normalize `~` at the same stage. Read
  // results may retain it while Write calls arrive expanded, which would make
  // the read-before-mutation registry treat one file as two paths.
  if (filePath === "~") return { path: homedir() };
  if (filePath.startsWith("~/")) return { path: join(homedir(), filePath.slice(2)) };

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

export function resolveToolPath(
  input: Record<string, unknown>,
  cwd: string,
): string | undefined {
  const key = pathKey(input);
  return key ? normalizeWritePath(String(input[key]), cwd).path : undefined;
}

// Shell commands are expressive enough that trying to prove arbitrary file
// access from the command string alone is a losing game (variables, functions,
// substitutions, globs, and redirects all matter). Keep this deliberately
// conservative: find explicit regular-file arguments to familiar readers, then
// separately require their bytes to be visible in the successful tool result.
const SHELL_READERS = new Set([
  "awk",
  "cat",
  "grep",
  "head",
  "rg",
  "sed",
  "tail",
]);

/** Split shell text into commands and words, sufficient for explicit paths. */
function shellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;

  const pushWord = () => {
    if (word) words.push(word);
    word = "";
  };
  const pushCommand = () => {
    pushWord();
    if (words.length) commands.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < command.length) word += command[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      word += command[++i];
      continue;
    }
    if (/\s/.test(ch)) {
      if (ch === "\n") pushCommand();
      else pushWord();
      continue;
    }
    if (ch === ";" || ch === "|") {
      pushCommand();
      if (command[i + 1] === ch) i++;
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      pushCommand();
      i++;
      continue;
    }
    // Redirection targets are not reader arguments. End this command at the
    // redirect; later chained commands will still be discovered normally.
    if (ch === ">" || ch === "<") {
      pushWord();
      while (i + 1 < command.length && command[i + 1] === ch) i++;
      while (i + 1 < command.length && command[i + 1] !== "\n" &&
        command[i + 1] !== ";" && command[i + 1] !== "|" && command[i + 1] !== "&") i++;
      continue;
    }
    word += ch;
  }
  pushCommand();
  return commands;
}

function resolveShellFile(token: string, cwd: string): string | undefined {
  if (!token || token === "-" || token.startsWith("-") || /[$*?{}()[\]`]/.test(token)) {
    return undefined;
  }
  const expanded = token === "~"
    ? homedir()
    : token.startsWith("~/")
      ? join(homedir(), token.slice(2))
      : token;
  const candidate = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Explicit regular files named as arguments to common shell readers. */
export function shellReadCandidates(command: string, cwd: string): string[] {
  const candidates = new Set<string>();
  for (const words of shellCommands(command)) {
    const reader = basename(words[0] ?? "");
    if (!SHELL_READERS.has(reader)) continue;
    for (const token of words.slice(1)) {
      const file = resolveShellFile(token, cwd);
      if (file) candidates.add(file);
    }
  }
  return [...candidates];
}

/** True when stdout/stderr contains a substantive, exact slice of the file. */
export function shellOutputShowsFile(output: string, filePath: string): boolean {
  let file: string;
  try {
    // Avoid loading an unexpectedly huge file merely to account for a read.
    if (statSync(filePath).size > 8 * 1024 * 1024) return false;
    file = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return false;
  }
  const shown = output.replace(/\r\n/g, "\n");
  const whole = file.replace(/\n+$/, "");
  if (whole && shown.includes(whole)) return true;

  // A partial sed/head/tail read is enough, just as an offset/limited Read is
  // today. Requiring a modest exact run avoids unlocking on generic output such
  // as "ok", a line number, or a filename alone.
  const fileLines = file.split("\n");
  const shownLines = shown.split("\n");
  for (let start = 0; start < shownLines.length; start++) {
    for (let at = 0; at < fileLines.length; at++) {
      let visible = 0;
      for (let n = 0;
        start + n < shownLines.length && at + n < fileLines.length &&
        shownLines[start + n] === fileLines[at + n];
        n++) {
        visible += shownLines[start + n].trim().length;
        if (visible >= 12) return true;
      }
    }
  }
  return false;
}

function readBeforeOverwriteReason(resolved: string): string {
  return `Blocked: ${resolved} already exists and has not been read this session. Read it, then retry Write or use Edit.`;
}

export function editBeforeReadReason(resolved: string): string {
  return `Blocked: ${resolved} has not been read this session. Read it, then retry Edit using the exact current text.`;
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
 * written by the structured Write tool.
 */
export function writeVerdict(
  resolved: string,
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
  pi.on("session_start", async () => {
    knownFiles.clear();
  });

  // A successful Read makes either mutation strategy valid. A successful Bash
  // read does too, but only when an explicit file argument and returned current
  // content corroborate one another. Successful Edit and Write calls keep the
  // authored file known for subsequent mutations.
  pi.on("tool_result", async (event, ctx) => {
    const name = String((event as any).toolName ?? "").toLowerCase();
    if ((event as any).isError) return;

    if (name === "bash") {
      const command = ((event as any).input ?? {})?.command;
      if (typeof command !== "string") return;
      const output = ((event as any).content ?? [])
        .filter((part: any) => part?.type === "text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("\n");
      for (const file of shellReadCandidates(command, ctx.cwd)) {
        if (shellOutputShowsFile(output, file)) knownFiles.add(file);
      }
      return;
    }

    if (name !== "read" && name !== "edit" && name !== "write") return;
    const resolved = resolveToolPath(
      ((event as any).input ?? {}) as Record<string, unknown>,
      ctx.cwd,
    );
    if (resolved) knownFiles.add(resolved);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (String((event as any).toolName ?? "").toLowerCase() !== "edit") return;
    const resolved = resolveToolPath(
      ((event as any).input ?? {}) as Record<string, unknown>,
      ctx.cwd,
    );
    if (!resolved || knownFiles.has(resolved)) return;
    harnessIntervention(
      ctx,
      "the model tried to edit an unread file — redirected it to Read first.",
    );
    return { block: true, reason: editBeforeReadReason(resolved) };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (String((event as any).toolName ?? "").toLowerCase() !== "write") return;
    const input = ((event as any).input ?? {}) as Record<string, unknown>;
    const key = pathKey(input);
    if (!key) return;

    const { path: resolved } = normalizeWritePath(String(input[key]), ctx.cwd);
    // Normalize in place so the executing write (built-in or custom) lands on
    // the resolved path even when we don't block (e.g. the `/foo.md` → cwd fix).
    input[key] = resolved;

    const verdict = writeVerdict(resolved, knownFiles.has(resolved));
    if (!verdict) return;
    harnessIntervention(ctx, verdict.intervention);
    return { block: true, reason: verdict.reason };
  });

}
