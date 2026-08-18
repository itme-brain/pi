import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import setupWriteGuard, {
  editBeforeReadReason,
  isReservedDeviceName,
  knownFiles,
  normalizeWritePath,
  resolveToolPath,
} from "./index.ts";

describe("normalizeWritePath", () => {
  const cwd = "/home/me/proj";

  it("rewrites /<bare-filename> to <cwd>/<bare-filename>", () => {
    // The model anchoring at filesystem root is the bug we're fixing.
    expect(normalizeWritePath("/foo.md", cwd)).toEqual({
      path: "/home/me/proj/foo.md",
      rewrittenFrom: "/foo.md",
    });
    expect(normalizeWritePath("/person.md", cwd)).toEqual({
      path: "/home/me/proj/person.md",
      rewrittenFrom: "/person.md",
    });
  });

  it("resolves bare filenames against cwd (no rewrite flag — already cwd-relative)", () => {
    expect(normalizeWritePath("foo.md", cwd)).toEqual({
      path: "/home/me/proj/foo.md",
    });
  });

  it("resolves nested relative paths against cwd", () => {
    expect(normalizeWritePath("sub/foo.md", cwd)).toEqual({
      path: "/home/me/proj/sub/foo.md",
    });
    expect(normalizeWritePath("a/b/c.md", cwd)).toEqual({
      path: "/home/me/proj/a/b/c.md",
    });
  });

  it("expands home-relative paths consistently across tools", () => {
    expect(normalizeWritePath("~/Documents/project/file.ts", cwd)).toEqual({
      path: join(homedir(), "Documents/project/file.ts"),
    });
  });

  it("leaves genuine absolute paths alone (path has an intermediate directory)", () => {
    // /etc/hosts has an intermediate directory, so it's a legitimate
    // absolute path. We don't rewrite it.
    expect(normalizeWritePath("/etc/hosts", cwd)).toEqual({
      path: "/etc/hosts",
    });
    expect(normalizeWritePath("/tmp/foo.log", cwd)).toEqual({
      path: "/tmp/foo.log",
    });
  });

  it("leaves deep absolute paths in cwd untouched", () => {
    // Model handing back its own cwd-prefixed path: unchanged.
    expect(normalizeWritePath("/home/me/proj/notes/plan.md", cwd)).toEqual({
      path: "/home/me/proj/notes/plan.md",
    });
  });
});

describe("unified read-before-mutation state", () => {
  const cwd = "/home/me/proj";

  function setup() {
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    setupWriteGuard({
      on(name: string, handler: (event: any, ctx: any) => any) {
        (handlers[name] ??= []).push(handler);
      },
    } as any);
    const fire = async (name: string, event: any, ctx = makeCtx(cwd)) => {
      for (const handler of handlers[name] ?? []) {
        const result = await handler(event, ctx);
        if (result?.block) return result;
      }
    };
    return { fire };
  }

  beforeEach(() => knownFiles.clear());

  it("blocks Edit before Read and allows it after Read", async () => {
    const h = setup();
    const edit = { toolName: "edit", input: { path: "a.ts", edits: [] } };
    expect((await h.fire("tool_call", edit))?.reason).toBe(
      editBeforeReadReason("/home/me/proj/a.ts"),
    );
    await h.fire("tool_result", {
      toolName: "read",
      isError: false,
      input: { path: "a.ts" },
    });
    expect(await h.fire("tool_call", edit)).toBeUndefined();
  });

  it("records a tilde Read for an expanded absolute Write", async () => {
    const h = setup();
    await h.fire("tool_result", {
      toolName: "read",
      isError: false,
      input: { path: "~/project/a.ts" },
    });
    expect(knownFiles.has(join(homedir(), "project/a.ts"))).toBe(true);
  });

  it("allows Write after the same extension observes a successful Read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-unified-"));
    const existing = join(dir, "existing.ts");
    writeFileSync(existing, "old\n");
    try {
      const h = setup();
      const ctx = makeCtx(dir);
      await h.fire(
        "tool_result",
        { toolName: "read", isError: false, input: { path: existing } },
        ctx,
      );
      expect(
        await h.fire(
          "tool_call",
          { toolName: "write", input: { path: existing, content: "new\n" } },
          ctx,
        ),
      ).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not record failed reads and clears state on session start", async () => {
    const h = setup();
    await h.fire("tool_result", {
      toolName: "read",
      isError: true,
      input: { path: "a.ts" },
    });
    expect(knownFiles.size).toBe(0);
    knownFiles.add("/known");
    await h.fire("session_start", {});
    expect(knownFiles.size).toBe(0);
  });

  it("resolves both path argument spellings", () => {
    expect(resolveToolPath({ path: "a.ts" }, cwd)).toBe("/home/me/proj/a.ts");
    expect(resolveToolPath({ file_path: "b.ts" }, cwd)).toBe("/home/me/proj/b.ts");
  });
});

// ── tool_call interceptor: the actual existing-file guard ───────────────────
// pi ships a built-in `write` that overwrites existing files and shadowed our
// old custom tool, so the guard never fired. We now enforce on the `tool_call`
// event, which catches whichever write implementation runs.

// write-guard registers TWO tool_call handlers — one for the `write` tool, one
// for shell tools (issue #70). Dispatch to both the way pi's runner does
// (core/extensions/runner.js::emitToolCall): run them in registration order and
// return the first result that blocks.
function getToolCallHandler() {
  const handlers: Array<(event: any, ctx: any) => any> = [];
  const pi = {
    on(name: string, h: (event: any, ctx: any) => any) {
      if (name === "tool_call") handlers.push(h);
    },
  };
  setupWriteGuard(pi as any);
  if (handlers.length === 0) throw new Error("write-guard did not register a tool_call handler");
  return async (event: any, ctx: any) => {
    let last: any;
    for (const h of handlers) {
      const result = await h(event, ctx);
      if (result) {
        last = result;
        if (result.block) return result;
      }
    }
    return last;
  };
}

function makeCtx(cwd: string) {
  const notifies: string[] = [];
  return { cwd, notifies, ui: { notify: (m: string) => notifies.push(m) } };
}

describe("write-guard tool_call interceptor", () => {
  let dir: string;
  let existing: string;
  beforeEach(() => {
    knownFiles.clear();
    dir = mkdtempSync(join(tmpdir(), "wg-"));
    existing = join(dir, "already.md");
    writeFileSync(existing, "old content\n");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("blocks a write to an unread existing file and requests a Read", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const event = { toolName: "write", input: { path: existing, content: "new" } };
    const result = await handler(event, ctx);
    expect(result?.block).toBe(true);
    expect(result.reason).toBe(
      `Blocked: ${existing} already exists and has not been read this session. ` +
        `Read it, then retry Write or use Edit.`,
    );
    expect(ctx.notifies[0]).toMatch(/harness intervention:.*Read first/i);
  });

  it("allows a write to an existing file after it has been read", async () => {
    const handler = getToolCallHandler();
    knownFiles.add(existing);
    const result = await handler(
      { toolName: "write", input: { path: existing, content: "new" } },
      makeCtx(dir),
    );
    expect(result).toBeUndefined();
  });

  it("allows a write to a NEW file (no block) and normalizes the path in place", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const input: any = { path: "fresh.md", content: "hi" };
    const event = { toolName: "write", input };
    const result = await handler(event, ctx);
    expect(result).toBeUndefined();
    expect(input.path).toBe(join(dir, "fresh.md")); // normalized relative → cwd
    expect(ctx.notifies).toHaveLength(0);
  });

  it("rewrites a root-anchored /<bare> path to cwd in place", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const input: any = { path: "/fresh.md", content: "hi" };
    await handler({ toolName: "write", input }, ctx);
    expect(input.path).toBe(join(dir, "fresh.md"));
  });

  it("honors the file_path arg key as well as path", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const result = await handler(
      { toolName: "write", input: { file_path: existing, content: "x" } },
      ctx,
    );
    expect(result?.block).toBe(true);
  });

  it("is case-insensitive on the tool name", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const result = await handler({ toolName: "Write", input: { path: existing } }, ctx);
    expect(result?.block).toBe(true);
  });

  it("ignores non-write tools", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const result = await handler({ toolName: "read", input: { path: existing } }, ctx);
    expect(result).toBeUndefined();
  });

  it("ignores a write call with no path argument", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    const result = await handler({ toolName: "write", input: { content: "x" } }, ctx);
    expect(result).toBeUndefined();
  });

  it("blocks a write to a reserved Windows device name (issue #60)", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    // Bare `nul` — the model treating it like /dev/null. On Windows this would
    // create an undeletable device-named file; we refuse on every platform.
    const result = await handler({ toolName: "write", input: { path: "nul", content: "x" } }, ctx);
    expect(result?.block).toBe(true);
    expect(result.reason).toBe(
      'Blocked: "nul" is a reserved Windows device name. Choose another filename.',
    );
    expect(ctx.notifies[0]).toMatch(/reserved device name/i);
  });

  it("blocks reserved device names with an extension and any case", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    for (const name of ["NUL.txt", "Com1", "lpt9.log", "AUX", "con"]) {
      const result = await handler({ toolName: "write", input: { path: name, content: "x" } }, ctx);
      expect(result?.block, `${name} should be blocked`).toBe(true);
    }
  });

  it("allows normal filenames that merely contain a reserved stem", async () => {
    const handler = getToolCallHandler();
    const ctx = makeCtx(dir);
    // `nullable.ts` / `console.log` are NOT reserved — only the exact stem is.
    for (const name of ["nullable.ts", "console.log", "auxiliary.md", "lpt.md"]) {
      const result = await handler({ toolName: "write", input: { path: name, content: "x" } }, ctx);
      expect(result, `${name} should pass`).toBeUndefined();
    }
  });
});

describe("isReservedDeviceName", () => {
  it("matches reserved device names regardless of case or extension", () => {
    for (const name of ["nul", "NUL", "Nul.txt", "con", "PRN", "aux", "com1", "COM9.log", "lpt1", "lpt9.dat"]) {
      expect(isReservedDeviceName(name), name).toBe(true);
      expect(isReservedDeviceName(`/home/me/proj/${name}`), name).toBe(true);
    }
  });
  it("does not match normal names that merely start with a reserved stem", () => {
    for (const name of ["nullable.ts", "console.log", "auxiliary", "com10", "lpt0", "comm", "null.d/real.txt"]) {
      expect(isReservedDeviceName(name), name).toBe(false);
    }
  });
});
