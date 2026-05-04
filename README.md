# pi

Personal config for [pi](https://github.com/badlogic/pi-mono), tuned for small local models.

## Setup

```bash
git clone git@github.com:itme-brain/pi.git ~/.pi/agent
npm install -g @mariozechner/pi-coding-agent
pi install npm:pi-mcp-adapter
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
| `read` | Built-in read wrapper that blocks broad log/large-file reads |
| `runtime-guards` | Hidden steers and context pruning for cross-turn local-model failure modes |
| `quality-monitor` | Detects loops/hallucinations, steers hidden self-correction into the next model call |
| `write-policy` | Keeps write new-file-only and adds append for existing docs |
| `thinking-budget` | Caps thinking tokens with retry-without-thinking fallback |
| `skill-inject` | Loads `skills/tools/*.md` based on intent |
| `knowledge-inject` | Loads `skills/protocols/*.md` based on relevance |
| `glob` | Bounded file glob with broad-search steering |
| `symbols` | Tree-sitter codebase navigation; `/explore` activates the full toolset |
