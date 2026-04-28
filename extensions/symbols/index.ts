/**
 * pi-symbols — Navigate codebases via tree-sitter symbols
 *
 * Tools:
 *   - file_symbols      : List all symbols in a single file
 *   - search_symbols    : Search symbols across the project by name/pattern
 *   - symbol_info       : Get detailed info about a specific symbol
 *   - symbol_source     : Get source for a specific symbol
 *   - project_overview  : High-level summary of codebase structure
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { extractFileSymbols, getLanguageForFile, type SymbolInfo } from "./parser.js";

// --- Cache ---
//
// Cache lives at <project-root>/.cache/pi-symbols/meta.json.
// Project root is the nearest ancestor containing .git (falls back to cwd).
// Resolved lazily on first tool call since ctx.cwd isn't available in session_start.

const CACHE_VERSION = 3;

interface CacheMeta {
  version: number;
  scannedAt: number;
  files: Record<string, { mtime: number; symbolCount: number; symbols: SymbolInfo[] }>;
}

let cacheMeta: CacheMeta | null = null;
let projectRoot: string | null = null;
let cacheLoaded = false;

async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);
  while (true) {
    try {
      await stat(join(current, ".git"));
      return current;
    } catch {
      // .git not found at this level
    }
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

function cacheFilePath(root: string): string {
  return join(root, ".cache", "pi-symbols", "meta.json");
}

async function ensureCacheLoaded(cwd: string): Promise<void> {
  if (cacheLoaded) return;
  cacheLoaded = true;
  projectRoot = await findProjectRoot(cwd);
  try {
    const raw = await readFile(cacheFilePath(projectRoot), "utf-8");
    const parsed = JSON.parse(raw) as CacheMeta;
    cacheMeta = parsed.version === CACHE_VERSION ? parsed : null;
  } catch {
    cacheMeta = null;
  }
}

async function saveCache(): Promise<void> {
  if (!projectRoot) return;
  const file = cacheFilePath(projectRoot);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cacheMeta, null, 2), "utf-8");
}

// --- File discovery ---

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "target",
  ".next", ".nuxt", ".cache", "__pycache__", ".tox", ".venv", "venv",
  ".pytest_cache", ".mypy_cache", ".idea", ".vscode",
]);

async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.endsWith(".egg-info")) {
        yield* walkFiles(fullPath);
      }
    } else if (entry.isFile() && getLanguageForFile(entry.name)) {
      yield fullPath;
    }
  }
}

// --- Symbol extraction with caching ---

async function extractWithCache(
  filePath: string,
): Promise<SymbolInfo[]> {
  const cacheKey = filePath;
  const now = Date.now();

  let mtime: number;
  try {
    mtime = (await stat(filePath)).mtimeMs;
  } catch {
    return [];
  }

  const cached = cacheMeta?.files[cacheKey];
  if (cached && Math.abs(mtime - cached.mtime) < 1000) {
    return cached.symbols;
  }

  let symbols: SymbolInfo[];
  try {
    const source = await readFile(filePath, "utf-8");
    symbols = await extractFileSymbols(filePath, source);
  } catch {
    symbols = [];
  }

  // Update cache
  if (!cacheMeta) {
    cacheMeta = { version: CACHE_VERSION, scannedAt: now, files: {} };
  }
  cacheMeta.files[cacheKey] = { mtime, symbolCount: symbols.length, symbols };

  return symbols;
}

function resolveInputPath(cwd: string, inputPath: string): string {
  const withoutAt = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
  const cleaned = withoutAt === "~" || withoutAt.startsWith("~/")
    ? join(process.env.HOME ?? cwd, withoutAt.slice(2))
    : withoutAt;
  return resolve(cwd, cleaned);
}

function resolveRoot(cwd: string, root?: string): string {
  return root ? resolveInputPath(cwd, root) : cwd;
}

function displayLine(sym: SymbolInfo): number {
  return sym.range.startLine;
}

function extractSymbolSource(source: string, sym: SymbolInfo, maxLines: number): { text: string; truncated: boolean } {
  const lines = source.split("\n");
  const start = Math.max(0, sym.range.startLine - 1);
  const end = Math.min(lines.length, sym.range.endLine);
  const selected = lines.slice(start, Math.min(end, start + maxLines));
  return { text: selected.join("\n"), truncated: end - start > selected.length };
}

function clampMaxLines(value: number | undefined): number {
  if (!Number.isFinite(value)) return 120;
  return Math.max(1, Math.min(300, Math.floor(value ?? 120)));
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async () => {
    if (cacheMeta && Object.keys(cacheMeta.files).length > 0) {
      cacheMeta.scannedAt = Date.now();
      try {
        await saveCache();
      } catch {
        // ignore cache write errors
      }
    }
  });

  // Tool 1: List symbols in a file
  pi.registerTool({
    name: "file_symbols",
    label: "File Symbols",
    description: "List symbols in one file.",
    promptSnippet: "List file symbols",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const filePath = resolveInputPath(cwd, params.path);
      const displayPath = relative(cwd, filePath);
      try {
        const source = await readFile(filePath, "utf-8");
        const symbols = await extractFileSymbols(filePath, source);

        if (symbols.length === 0) {
          return {
            content: [{ type: "text", text: `No parseable symbols found in ${displayPath}` }],
            details: { path: filePath, symbolCount: 0 },
          };
        }

        const lines = [`${symbols.length} symbols in ${displayPath}:`];
        for (const sym of symbols) {
          const parent = sym.parent ? `${sym.parent}.` : "";
          const sig = sym.signature ? ` — ${sym.signature.slice(0, 120)}` : "";
          lines.push(`${displayPath}:${displayLine(sym)} ${sym.kind} ${parent}${sym.name}${sig}`);
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { path: filePath, symbols },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error reading ${displayPath}: ${(err as Error).message}` }],
          details: { error: true },
        };
      }
    },
  });

  // Tool 2: Search symbols across the project
  pi.registerTool({
    name: "search_symbols",
    label: "Search Symbols",
    description: "Search project symbols.",
    promptSnippet: "Search symbols",
    parameters: Type.Object({
      query: Type.Optional(Type.String()),
      kind: Type.Optional(Type.String()),
      language: Type.Optional(Type.String()),
      maxResults: Type.Optional(Type.Number()),
      root: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await ensureCacheLoaded(ctx.cwd);
      const cwd = resolveRoot(ctx.cwd, params.root);
      const query = (params.query ?? "").toLowerCase();
      const kindFilter = params.kind?.toLowerCase();
      const langFilter = params.language?.toLowerCase();
      const maxResults = params.maxResults ?? 50;

      let totalSymbols: SymbolInfo[] = [];
      let fileCount = 0;

      for await (const filePath of walkFiles(cwd)) {
        // Language filter
        if (langFilter && getLanguageForFile(filePath) !== langFilter) continue;

        const symbols = await extractWithCache(filePath);
        fileCount++;

        // Name/kind filters
        const filtered = symbols.filter((s) => {
          if (kindFilter && s.kind !== kindFilter) return false;
          if (query && !s.name.toLowerCase().includes(query)) return false;
          return true;
        });

        totalSymbols.push(...filtered);
        if (totalSymbols.length > maxResults * 3) break; // early exit with buffer
      }

      // Sort: exported first, then by path/name
      totalSymbols.sort((a, b) => {
        if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const results = totalSymbols.slice(0, maxResults);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No symbols found${query ? ` matching "${query}"` : ""} across ${fileCount} files.` }],
          details: { totalScanned: fileCount, results: [], query, kind: kindFilter, language: langFilter },
        };
      }

      const lines = [`${results.length}/${totalSymbols.length} symbols (scanned ${fileCount} files):`];
      for (const sym of results) {
        const relPath = relative(cwd, sym.path);
        lines.push(`${relPath}:${displayLine(sym)} ${sym.kind} ${sym.name}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { totalFound: totalSymbols.length, results, scannedFiles: fileCount },
      };
    },
  });

  // Tool 3: Get detailed symbol info
  pi.registerTool({
    name: "symbol_info",
    label: "Symbol Info",
    description: "Show symbol details; references=true for call sites.",
    promptSnippet: "Show symbol info",
    parameters: Type.Object({
      name: Type.String(),
      path: Type.Optional(Type.String()),
      root: Type.Optional(Type.String()),
      references: Type.Optional(Type.Boolean()),
      maxReferences: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await ensureCacheLoaded(ctx.cwd);
      const cwd = resolveRoot(ctx.cwd, params.root);
      const query = params.name.toLowerCase();

      let targetFile = params.path ? resolveInputPath(cwd, params.path) : null;

      if (targetFile && !(await stat(targetFile).catch(() => null))) {
        return {
          content: [{ type: "text", text: `File not found: ${params.path}` }],
          details: { error: true },
        };
      }

      const allSymbols: SymbolInfo[] = [];

      if (targetFile) {
        const source = await readFile(targetFile, "utf-8");
        const symbols = await extractFileSymbols(targetFile, source);
        allSymbols.push(...symbols.filter((s) => s.name.toLowerCase() === query));
      } else {
        for await (const filePath of walkFiles(cwd)) {
          const symbols = await extractWithCache(filePath);
          allSymbols.push(...symbols.filter((s) => s.name.toLowerCase() === query));
        }
      }

      if (allSymbols.length === 0) {
        return {
          content: [{ type: "text", text: `No symbol named "${params.name}" found.` }],
          details: { name: params.name, matches: [] },
        };
      }

      const lines = [`${allSymbols.length} match(es) for "${params.name}":`];
      for (const sym of allSymbols) {
        const relPath = relative(cwd, sym.path);
        const parent = sym.parent ? ` parent=${sym.parent}` : "";
        const exported = sym.isExported ? " exported" : "";
        const sig = sym.signature ? ` — ${sym.signature.slice(0, 200)}` : "";
        lines.push(`${relPath}:${displayLine(sym)} ${sym.kind} ${sym.name}${parent}${exported}${sig}`);
        if (sym.docstring) lines.push(`doc: ${sym.docstring.slice(0, 300)}`);
      }

      let refs: Array<{ path: string; line: number; text: string }> = [];
      if (params.references) {
        const maxRefs = Math.max(1, Math.min(200, params.maxReferences ?? 20));
        const defLines = new Map<string, Set<number>>();
        for (const sym of allSymbols) {
          const set = defLines.get(sym.path) ?? new Set();
          set.add(sym.range.startLine);
          defLines.set(sym.path, set);
        }

        let rgStdout: string | null = null;
        let rgError: string | null = null;
        try {
          const result = await execFileP("rg", [
            "--json",
            "--fixed-strings",
            "--word-regexp",
            `--max-count=${maxRefs}`,
            params.name,
            cwd,
          ], { maxBuffer: 8 * 1024 * 1024 });
          rgStdout = result.stdout;
        } catch (err: any) {
          if (err?.code === "ENOENT") rgError = "rg not on PATH";
          else if (err?.code === 1) rgStdout = err?.stdout ?? "";
          else rgError = String(err?.message ?? err);
        }

        if (rgError) {
          lines.push(`\nReferences unavailable: ${rgError}.`);
        } else if (rgStdout !== null) {
          for (const rawLine of rgStdout.split("\n")) {
            if (!rawLine) continue;
            let evt: any;
            try { evt = JSON.parse(rawLine); } catch { continue; }
            if (evt.type !== "match") continue;
            const path = evt.data?.path?.text;
            const lineNo = evt.data?.line_number;
            const text = evt.data?.lines?.text;
            if (typeof path !== "string" || typeof lineNo !== "number" || typeof text !== "string") continue;
            if (defLines.get(path)?.has(lineNo)) continue;
            refs.push({ path, line: lineNo, text: text.replace(/\r?\n$/, "").trim().slice(0, 200) });
            if (refs.length >= maxRefs) break;
          }

          if (refs.length === 0) {
            lines.push(`\nNo references found.`);
          } else {
            lines.push(`\n${refs.length} reference(s)${refs.length >= maxRefs ? " (capped)" : ""}:`);
            for (const ref of refs) {
              lines.push(`${relative(cwd, ref.path)}:${ref.line} ${ref.text}`);
            }
          }
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { name: params.name, matches: allSymbols, references: refs },
      };
    },
  });

  // Tool 4: Get symbol source
  pi.registerTool({
    name: "symbol_source",
    label: "Symbol Source",
    description: "Show symbol source.",
    promptSnippet: "Show symbol source",
    parameters: Type.Object({
      name: Type.String(),
      path: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
      maxLines: Type.Optional(Type.Number()),
      root: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await ensureCacheLoaded(ctx.cwd);
      const cwd = resolveRoot(ctx.cwd, params.root);
      const query = params.name.toLowerCase();
      const maxLines = clampMaxLines(params.maxLines);
      const targetFile = params.path ? resolveInputPath(cwd, params.path) : null;

      if (targetFile && !(await stat(targetFile).catch(() => null))) {
        return {
          content: [{ type: "text", text: `File not found: ${params.path}` }],
          details: { error: true },
        };
      }

      const matches: SymbolInfo[] = [];
      const files = targetFile ? [targetFile] : [];
      if (!targetFile) {
        for await (const filePath of walkFiles(cwd)) files.push(filePath);
      }

      for (const filePath of files) {
        const symbols = targetFile
          ? await extractFileSymbols(filePath, await readFile(filePath, "utf-8"))
          : await extractWithCache(filePath);
        matches.push(...symbols.filter((s) => {
          if (s.name.toLowerCase() !== query) return false;
          if (params.line && (params.line < s.range.startLine || params.line > s.range.endLine)) return false;
          return true;
        }));
      }

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No symbol named "${params.name}" found.` }],
          details: { name: params.name, matches: [] },
        };
      }

      const lines: string[] = [];
      for (const sym of matches.slice(0, 5)) {
        const source = await readFile(sym.path, "utf-8");
        const relPath = relative(cwd, sym.path);
        const body = extractSymbolSource(source, sym, maxLines);
        lines.push(`${relPath}:${sym.range.startLine}-${sym.range.endLine} ${sym.kind} ${sym.name}${body.truncated ? " truncated" : ""}`);
        lines.push(body.text);
      }
      if (matches.length > 5) lines.push(`... ${matches.length - 5} more match(es)`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { name: params.name, matches: matches.slice(0, 5) },
      };
    },
  });

  // Tool 5: Project overview
  pi.registerTool({
    name: "project_overview",
    label: "Project Overview",
    description: "Summarize project symbols.",
    promptSnippet: "Summarize symbols",
    parameters: Type.Object({
      root: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await ensureCacheLoaded(ctx.cwd);
      const cwd = resolveRoot(ctx.cwd, params.root);
      const langCounts = new Map<string, number>();
      const kindCounts = new Map<string, number>();
      const exported: SymbolInfo[] = [];
      let totalFiles = 0;
      let totalSymbols = 0;

      for await (const filePath of walkFiles(cwd)) {
        const symbols = await extractWithCache(filePath);
        const lang = getLanguageForFile(filePath) ?? "unknown";
        langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
        totalFiles++;
        totalSymbols += symbols.length;

        for (const sym of symbols) {
          kindCounts.set(sym.kind, (kindCounts.get(sym.kind) ?? 0) + 1);
          if (sym.isExported) exported.push(sym);
        }
      }

      const lines = [`Project Overview (${totalFiles} files, ${totalSymbols} symbols):`];

      lines.push("\nLanguages:");
      for (const [lang, count] of [...langCounts.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${lang}: ${count} file(s)`);
      }

      lines.push("\nSymbols by kind:");
      for (const [kind, count] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${kind}: ${count}`);
      }

      exported.sort((a, b) => a.name.localeCompare(b.name));

      if (exported.length > 0) {
        lines.push("\nTop exported symbols:");
        for (const sym of exported.slice(0, 20)) {
          const relPath = relative(cwd, sym.path);
          lines.push(`${relPath}:${displayLine(sym)} ${sym.kind} ${sym.name}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { totalFiles, totalSymbols, languages: Object.fromEntries(langCounts), kinds: Object.fromEntries(kindCounts) },
      };
    },
  });

  // --- Lazy activation: only search_symbols + project_overview are always
  // visible to the model. The other three become available once any symbols
  // tool fires (sticky), so once you're in a code session there's no churn.
  // /explore force-activates the full set and kicks off a discovery turn.

  const SYMBOL_TOOL_NAMES = ["file_symbols", "search_symbols", "symbol_info", "symbol_source", "project_overview"];
  const ALWAYS_ON_SYMBOL_NAMES = ["search_symbols", "project_overview"];

  let stickyActive = false;

  pi.on("session_start", async () => {
    stickyActive = false;
  });

  pi.on("before_agent_start", async () => {
    const current: any[] = pi.getActiveTools();
    const currentNames = current
      .map((t) => (typeof t === "string" ? t : t?.name))
      .filter((n): n is string => typeof n === "string");
    const others = currentNames.filter((n) => !SYMBOL_TOOL_NAMES.includes(n));
    const symbols = stickyActive ? SYMBOL_TOOL_NAMES : ALWAYS_ON_SYMBOL_NAMES;
    pi.setActiveTools([...others, ...symbols]);
  });

  pi.on("tool_execution_start", async (event) => {
    const name = (event as any).toolName;
    if (typeof name === "string" && SYMBOL_TOOL_NAMES.includes(name)) {
      stickyActive = true;
    }
  });

  pi.registerCommand("explore", {
    description: "Explore the codebase with symbols tools",
    handler: async (_args, ctx) => {
      stickyActive = true;
      ctx.ui.notify("symbols tools active", "info");
      pi.sendUserMessage("Explore this codebase. Use the symbols tools.");
    },
  });
}
