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
extensions/   agent tools and safety guards
skills/       tool guidance + compact knowledge cards
mcp.json      web-search MCP server config
models.json   model-specific provider overrides
settings.json pi settings
```

## Extensions

| | |
|---|---|
| `write-guard` | Requires Read before structured Edit or Write calls on existing files |
| `skill-inject` | Loads `skills/tools/*.md` based on intent |
| `knowledge-inject` | Loads `skills/knowledge/*.md` based on relevance |
| `extra-tools` | Bounded file glob with broad-search steering |
| `symbols` | Tree-sitter codebase navigation; `/explore` activates the full toolset |
| `instruct` | Applies the local instruct-mode sampling profile when thinking is off |
