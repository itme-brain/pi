# pi-symbols

Navigate codebases via tree-sitter symbols — functions, classes, methods, imports with signatures and docstrings.

## How it works

Uses **web-tree-sitter** (WASM) + pinned WASM grammars for zero-native-compilation parsing:
- TypeScript/TSX, JavaScript, Python, Rust, Go, C/C++, Java, Ruby, PHP, C#, Bash

## Tools

| Tool | Description |
|------|-------------|
| `file_symbols` | List all symbols in a single file |
| `search_symbols` | Search symbols across the project (by name, kind, language) |
| `symbol_info` | Get detailed info about a specific symbol |
| `symbol_source` | Show source for a specific symbol |
| `project_overview` | High-level summary of codebase structure |

## Example usage

```
# See all symbols in a file
file_symbols(path="src/auth.ts")

# Search for "Greeter" across the project
search_symbols(query="Greeter")

# Search another repo without restarting pi there
search_symbols(query="Greeter", root="~/src/other-repo")

# Find all exported classes
search_symbols(kind="class", query="Service")

# Get details on a specific symbol
symbol_info(name="authenticate", path="src/auth.ts")

# Get implementation for a specific symbol
symbol_source(name="authenticate", path="src/auth.ts")

# See the big picture
project_overview()
```

## Caching

Symbol data is cached in `~/.pi/agent/symbols-cache/meta.json`. Files are re-parsed only when their mtime changes.

## Dependencies (deterministic)

- `@vscode/tree-sitter-wasm` 0.3.1 — prebuilt WASM grammars from VS Code
- `tree-sitter-c` 0.24.1 — prebuilt WASM grammar for C
- `web-tree-sitter` 0.26.8 — official tree-sitter WASM runtime

All are version-locked in package.json + package-lock.json. No native compilation needed.
