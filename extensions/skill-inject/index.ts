import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFile } from "./frontmatter.ts";
import { injectionResult, makeDedupe } from "../_shared/inject.ts";

// ── Tool-skill registry ─────────────────────────────────────────────────
// Port of local/skill_augment.py. Loads skills/tools/*.md once, hooks
// `before_agent_start` to add a `## Tool Usage Guidance` block to the turn.
// Per-user-prompt selection using the whitepaper's 3-priority algorithm
// (error recovery > recency > intent). Budget-guarded, cached.
//
// The block is delivered as a tail message rather than appended to the system
// prompt — see _shared/inject.ts for why (issue #73: it was invalidating the
// KV cache on every turn).

interface ToolSkill {
  targetTool: string;
  body: string;
  tokenCost: number;
}

const skills = new Map<string, ToolSkill>();
const selectionCache = new Map<string, string>();
let loaded = false;
const SKILL_TOKEN_BUDGET = 300;

// State tracked across the session so we have error-recovery + recency
// signals by the time the next `before_agent_start` fires.
const recentToolCalls: string[] = []; // most-recent-first, capped at 8
let lastFailedTool: string | null = null;

// ── Intent keywords → likely tools ──────────────────────────────────────
const INTENT_MAP: Record<string, string[]> = {
  read: ["Read"], show: ["Read"], view: ["Read"], cat: ["Read"],
  write: ["Write"], create: ["Write", "Bash"],
  implement: ["Write", "Read"], code: ["Write", "Read"],
  function: ["Write", "Edit"], class: ["Write", "Edit"],
  edit: ["Edit"], change: ["Edit"], modify: ["Edit"],
  fix: ["Edit"], update: ["Edit"], replace: ["Edit"],
  add: ["Edit", "Write"], refactor: ["Edit", "Read"],
  run: ["Bash"], execute: ["Bash"], install: ["Bash"],
  build: ["Bash"], test: ["Bash"],
  find: ["Glob", "Grep"], search: ["Grep"],
  grep: ["Grep"], glob: ["Glob"],
};

function skillsDir(): string {
  // Extension lives at <agent>/extensions/skill-inject/, agent root is 2 levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "skills", "tools");
}

function loadSkills(): void {
  if (loaded) return;
  loaded = true;
  const dir = skillsDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const parsed = parseSkillFile(readFileSync(join(dir, file), "utf-8"));
    if (!parsed) continue;
    const target = parsed.frontmatter.target_tool;
    if (typeof target !== "string" || !target) continue;
    // Charge the body that is actually injected; frontmatter estimates drift
    // whenever guidance is edited.
    const cost = Math.ceil(parsed.body.length / 3.5);
    skills.set(target.toLowerCase(), { targetTool: target, body: parsed.body, tokenCost: cost });
  }
}

function predictTools(userText: string): string[] {
  const words = new Set(userText.toLowerCase().split(/\s+/).filter(Boolean));
  const predicted: string[] = [];
  for (const [kw, toolNames] of Object.entries(INTENT_MAP)) {
    if (!words.has(kw)) continue;
    for (const tn of toolNames) if (!predicted.includes(tn)) predicted.push(tn);
  }
  return predicted;
}

function selectSkills(prompt: string, budget: number, allowed?: Set<string>): ToolSkill[] {
  const selected: ToolSkill[] = [];
  let used = 0;
  const tryAdd = (name: string): void => {
    const key = name.toLowerCase();
    const sk = skills.get(key);
    if (!sk || selected.includes(sk)) return;
    if (allowed && !allowed.has(key)) return;
    if (used + sk.tokenCost > budget) return;
    selected.push(sk);
    used += sk.tokenCost;
  };

  // 1. Error recovery — last failed tool
  if (lastFailedTool) tryAdd(lastFailedTool);

  // 2. Recency — last 2 tool calls
  for (const name of recentToolCalls.slice(0, 4)) {
    if (used >= budget) break;
    tryAdd(name);
  }

  // 3. Intent prediction on the user's current prompt
  if (used < budget) {
    for (const name of predictTools(prompt)) {
      if (used >= budget) break;
      tryAdd(name);
    }
  }

  return selected;
}

function buildBlock(selected: ToolSkill[]): string {
  let out = "\n\n## Tool Usage Guidance\n";
  for (const s of selected) out += `\n### ${s.targetTool}\n${s.body}\n`;
  return out;
}

export default function (pi: ExtensionAPI) {
  const shouldInject = makeDedupe();

  // Track tool usage across the whole session so recency + error-recovery
  // state is available on the next before_agent_start.
  pi.on("tool_result", async (event) => {
    const name = (event as any).toolName || (event as any).name;
    if (typeof name === "string") {
      // prepend, keep deduplicated recency list capped
      const idx = recentToolCalls.indexOf(name);
      if (idx !== -1) recentToolCalls.splice(idx, 1);
      recentToolCalls.unshift(name);
      if (recentToolCalls.length > 8) recentToolCalls.length = 8;
    }
    const isError = (event as any).isError === true;
    lastFailedTool = isError && typeof name === "string" ? name : null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    loadSkills();
    if (skills.size === 0) return;

    const opts: any = (event as any).systemPromptOptions ?? {};

    // Knowledge-inject may publish required_tools on systemPromptOptions —
    // pre-add those before selecting so they win even when budget is tight.
    // Benchmark profiles can also publish requiredTools.
    const preferred: string[] = Array.isArray(opts.agentAugmentation?.requiredTools)
      ? opts.agentAugmentation.requiredTools
      : [];
    for (const t of preferred) {
      if (!recentToolCalls.includes(t)) recentToolCalls.unshift(t);
    }

    const selected = selectSkills(event.prompt ?? "", SKILL_TOKEN_BUDGET);
    if (selected.length === 0) return;

    const skillBlock = selected.length > 0
      ? (() => {
          const key = selected.map((s) => s.targetTool).sort().join("|");
          let b = selectionCache.get(key);
          if (b === undefined) {
            b = buildBlock(selected);
            selectionCache.set(key, b);
          }
          return b;
        })()
      : "";

    // Identical to last turn's block? The previous copy is still in the
    // conversation, so re-sending it would only burn context.
    if (!shouldInject(skillBlock)) return;

    // Fire-and-forget notify so the benchmark harness can count per-turn
    // skill injections without having to reconstruct the prompt.
    try {
      ctx.ui.notify(
        `skill-inject: +${selected.length} [${selected.map((s) => s.targetTool).join(",")}]`,
        "info",
      );
    } catch {
      // UI unavailable in some run modes — silent best-effort
    }

    return injectionResult("lc-skills", skillBlock);
  });
}
