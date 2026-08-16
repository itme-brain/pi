# pi

Personal config for [pi](https://github.com/itme-brain/pi-mono), tuned for small local models.

## Setup

```bash
git clone git@github.com:itme-brain/pi.git ~/.pi/agent
git clone https://github.com/itme-brain/pi-mono ~/.pi/harness
cd ~/.pi/harness
npm install
npm --prefix packages/tui run build
npm --prefix packages/ai run build
npm --prefix packages/agent run build
npm --prefix packages/coding-agent run build
npm install -g ./packages/coding-agent
pi install npm:pi-mcp-adapter
```

Harness remotes:

```text
origin    git@github.com:itme-brain/pi-mono
upstream  https://github.com/badlogic/pi-mono.git
```

Review and pull upstream through the fork:

```bash
cd ~/.pi/harness
git fetch upstream
git diff main..upstream/main -- packages/coding-agent packages/agent packages/ai packages/tui
git merge --ff-only upstream/main
git push origin main
npm install
npm --prefix packages/tui run build
npm --prefix packages/ai run build
npm --prefix packages/agent run build
npm --prefix packages/coding-agent run build
npm install -g ./packages/coding-agent
git restore packages/ai/src/models.generated.ts
```

Required env vars:
- `LLAMA_API_KEY` — inference and web-search MCP key

## Layout

```
extensions/   small-model survival kit
skills/       tool guidance + compact knowledge cards
mcp.json      web-search MCP server config
models.json   custom llamacpp provider
settings.json pi settings
```

## Extensions

| | |
|---|---|
| `quality-monitor` | Detects loops/dead-ends, steers hidden self-correction, and prunes monitor noise |
| `write-guard` | Requires Read before Edit or overwriting existing files, including through the shell |
| `thinking-budget` | Caps thinking tokens with retry-without-thinking fallback |
| `skill-inject` | Loads `skills/tools/*.md` based on intent |
| `knowledge-inject` | Loads `skills/knowledge/*.md` based on relevance |
| `extra-tools` | Bounded file glob with broad-search steering |
| `symbols` | Tree-sitter codebase navigation; `/explore` activates the full toolset |
| `instruct` | Applies the local instruct-mode sampling profile when thinking is off |
