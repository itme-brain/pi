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
- `LLAMACPP_BASE_URL` — OpenAI-compatible inference endpoint
- `LLAMACPP_API_KEY` — inference API key
- `LLAMA_API_KEY` — web-search MCP key (X-API-Key header)

## Layout

```
extensions/   small-model survival kit
skills/       protocols/ + tools/ guidance
mcp.json      web-search MCP server config
models.json   custom llamacpp provider
settings.json pi settings
```

## Extensions

| | |
|---|---|
| `quality-monitor` | Detects loops/dead-ends, steers hidden self-correction, and prunes monitor noise |
| `write-policy` | Keeps write new-file-only and adds append for existing docs |
| `thinking-budget` | Caps thinking tokens with retry-without-thinking fallback |
| `skill-inject` | Loads `skills/tools/*.md` based on intent |
| `knowledge-inject` | Loads `skills/protocols/*.md` based on relevance |
| `glob` | Bounded file glob with broad-search steering |
| `symbols` | Tree-sitter codebase navigation; `/explore` activates the full toolset |
