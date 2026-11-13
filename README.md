# pi

Personal config for [Pi](https://github.com/earendil-works/pi), tuned for local models.

## Setup

Enable `modules.user.pi` in Home Manager. The CLI comes from
`pkgs.unstable.pi-coding-agent`; its version is controlled by `flake.lock`.
Update it with `nix flake update nixpkgs-unstable`, then rebuild the system.
The generated settings point Pi's package manager at upstream npm without
adding Node to the user profile.

Activation syncs this directory to `~/.pi/agent`, preserving the runtime files
listed in `.gitignore`. The `pi-extension-dependencies` user service installs
local extension dependencies with upstream Node.js after login. To rerun it:

```bash
systemctl --user restart pi-extension-dependencies.service
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
| `write-guard` | Requires current file content from Read or a corroborated shell read before Edit/Write |
| `skill-inject` | Loads `skills/tools/*.md` based on intent |
| `knowledge-inject` | Loads `skills/knowledge/*.md` based on relevance |
| `extra-tools` | Bounded file glob with broad-search steering |
| `symbols` | Tree-sitter codebase navigation; `/explore` activates the full toolset |
| `instruct` | Applies the local instruct-mode sampling profile when thinking is off |
