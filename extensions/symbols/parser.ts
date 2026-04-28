/**
 * Tree-sitter parser setup using web-tree-sitter + @vscode/tree-sitter-wasm grammars.
 * Prebuilt WASM grammars — no native compilation needed.
 *
 * Lazy init: Parser.init() is called on first parse, not at session_start.
 * Rationale: WASM init takes ~100ms. If no symbols tools are called in a session,
 * we waste nothing. First tool call pays the cold start cost — acceptable for
 * an optional navigation tool (not core infrastructure like read/bash).
 */

import { createRequire } from "node:module";
import { extname } from "node:path";
import { Parser, Language, type Tree } from "web-tree-sitter";

const require = createRequire(import.meta.url);

// --- WASM init (called once) ---

let _initDone = false;

async function ensureInit(): Promise<void> {
  if (_initDone) return;
  await Parser.init();
  _initDone = true;
}

// --- Language registry ---

interface LanguageEntry {
  name: string;
  extensions: string[];
  wasmName?: string;
}

const LANGUAGES: LanguageEntry[] = [
  { name: "typescript", extensions: [".ts", ".mts", ".cts"] },
  { name: "tsx", extensions: [".tsx"] },
  { name: "javascript", extensions: [".js", ".mjs", ".cjs"] },
  { name: "python", extensions: [".py", ".pyi"] },
  { name: "rust", extensions: [".rs"] },
  { name: "go", extensions: [".go"] },
  { name: "c", extensions: [".c", ".h"] },
  { name: "cpp", extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx"] },
  { name: "java", extensions: [".java"] },
  { name: "ruby", extensions: [".rb", ".rbw"] },
  { name: "php", extensions: [".php"] },
  { name: "csharp", wasmName: "c-sharp", extensions: [".cs"] },
  { name: "bash", extensions: [".sh", ".bash", ".zsh"] },
];

const EXT_TO_LANG = new Map<string, string>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    EXT_TO_LANG.set(ext, lang.name);
  }
}

export function getLanguageForFile(filePath: string): string | null {
  return EXT_TO_LANG.get(extname(filePath).toLowerCase()) ?? null;
}

// --- Parser with lazy language loading ---

const loadedLanguages = new Map<string, Language>();
const WASM_LANGUAGE_NAMES = new Map(
  LANGUAGES.map((language) => [language.name, language.wasmName ?? language.name]),
);
async function loadLanguage(name: string): Promise<Language> {
  const cached = loadedLanguages.get(name);
  if (cached) return cached;

  const wasmName = WASM_LANGUAGE_NAMES.get(name) ?? name;
  const wasmPath = name === "c"
    ? require.resolve("tree-sitter-c/tree-sitter-c.wasm")
    : require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${wasmName}.wasm`);
  const language = await Language.load(wasmPath);
  loadedLanguages.set(name, language);
  return language;
}

// --- Node type helpers for symbol extraction ---

function getSymbolKind(nodeType: string): string | null {
  // TypeScript/JS
  if (nodeType === "function_declaration" || nodeType === "method_definition") return "function";
  if (nodeType === "class_declaration" || nodeType === "class_expression") return "class";
  if (nodeType === "interface_declaration") return "interface";
  if (nodeType === "type_alias_declaration") return "type";
  if (nodeType === "import_statement") return "import";
  if (nodeType === "enum_declaration") return "enum";

  // Python
  if (nodeType === "function_definition") return "function";
  if (nodeType === "class_definition") return "class";
  if (nodeType === "import_statement" || nodeType === "import_from_statement") return "import";
  if (nodeType === "assignment") return "variable";

  // Rust
  if (nodeType === "function_item" || nodeType === "method_item") return "function";
  if (nodeType === "struct_item") return "struct";
  if (nodeType === "enum_definition") return "enum";
  if (nodeType === "impl_item") return "class";

  // Go
  if (nodeType === "function_declaration" || nodeType === "method_spec") return "function";
  if (nodeType === "type_declaration") return "type";

  // Java
  if (nodeType === "method_declaration") return "function";
  if (nodeType === "class_declaration") return "class";
  if (nodeType === "interface_declaration") return "interface";

  // PHP
  if (nodeType === "function_definition" || nodeType === "method_declaration") return "function";
  if (nodeType === "class_declaration") return "class";

  // C/C++
  if (nodeType === "function_definition") return "function";
  if (nodeType === "class_specifier") return "class";
  if (nodeType === "struct_specifier") return "struct";

  // Ruby
  if (nodeType === "method") return "function";
  if (nodeType === "singleton_method") return "function";
  if (nodeType === "class") return "class";

  // Bash
  if (nodeType === "function_definition") return "function";

  return null;
}

function getNameNode(node: Tree["rootNode"]): string | null {
  return getDirectName(node) ?? findFirstIdentifier(node, 4);
}

function getDirectName(node: Tree["rootNode"]): string | null {
  const nameField = node.childForFieldName("name");
  if (nameField) return nameField.text;

  for (const child of node.children) {
    if (child.type === "identifier" || child.type === "type_identifier" || child.type === "property_identifier") {
      return child.text;
    }
  }

  return null;
}

function findFirstIdentifier(node: Tree["rootNode"], maxDepth: number): string | null {
  if (maxDepth <= 0) return null;
  for (const child of node.children) {
    if (child.type === "identifier" || child.type === "type_identifier" || child.type === "property_identifier") {
      return child.text;
    }
    const nested = findFirstIdentifier(child, maxDepth - 1);
    if (nested) return nested;
  }
  return null;
}

function extractSignature(source: string, node: Tree["rootNode"]): string | undefined {
  const text = source.slice(node.startIndex, node.endIndex);
  let endIdx = text.length;

  const terminators = ["{", "\n", ";"]
    .map((terminator) => text.indexOf(terminator))
    .filter((index) => index >= 0);
  if (terminators.length > 0) {
    endIdx = Math.min(...terminators);
  }

  let sig = text.slice(0, endIdx).trim();
  sig = sig.replace(/\s+/g, " ");
  return sig || undefined;
}

function isCommentNode(t: string): boolean {
  return t === "comment" || t === "line_comment" || t === "block_comment";
}

// Walk up through wrappers (export_statement, decorated_definition) so that
// `previousSibling` looks at the correct level — leading comments sit beside
// the outermost wrapper, not the inner declaration.
function commentAnchor(node: Tree["rootNode"]): Tree["rootNode"] {
  let anchor = node;
  while (
    anchor.parent &&
    (anchor.parent.type === "export_statement" || anchor.parent.type === "decorated_definition")
  ) {
    anchor = anchor.parent;
  }
  return anchor;
}

function getLeadingComment(node: Tree["rootNode"]): string | null {
  const anchor = commentAnchor(node);
  const blocks: string[] = [];
  let nextStartRow = anchor.startPosition.row;
  let prev = anchor.previousSibling;
  while (prev && isCommentNode(prev.type)) {
    // Require the comment to be adjacent (no blank-line gap) to the next block.
    if (nextStartRow - prev.endPosition.row > 1) break;
    blocks.unshift(prev.text);
    nextStartRow = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  if (blocks.length === 0) return null;

  const cleaned = blocks
    .flatMap((block) => block.split("\n"))
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== "/**" && l !== "/*" && l !== "*/")
    .map((l) =>
      l
        .replace(/^(\*\s*|\/\/\/\s*|\/\/\s*|#\s*|\/\*\*?\s*)/, "")
        .replace(/\s*\*\/\s*$/, ""),
    )
    .join("\n")
    .trim();

  return cleaned || null;
}

function isExported(node: Tree["rootNode"]): boolean {
  const parent = node.parent;
  if (parent?.type === "export_statement") return true;

  // Rust: visibility_modifier child wraps `pub`, `pub(crate)`, `pub(super)`, etc.
  for (const child of node.children) {
    if (child.type === "visibility_modifier") return true;
  }

  return false;
}

function getParentName(node: Tree["rootNode"]): string | null {
  let current = node.parent;
  while (current) {
    const name = getDirectName(current);
    if (name) return name;
    current = current.parent;
  }
  return null;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  path: string;
  range: {
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  };
  signature?: string;
  docstring?: string;
  visibility?: "public" | "private" | "protected";
  parent?: string;
  isExported?: boolean;
}

export async function extractSymbols(
  source: string,
  tree: Tree,
  filePath: string,
): Promise<SymbolInfo[]> {
  const symbols: SymbolInfo[] = [];

  function walk(node: Tree["rootNode"]) {
    const kind = getSymbolKind(node.type);
    if (!kind) {
      for (const child of node.children) walk(child);
      return;
    }

    const name = getNameNode(node);
    if (!name) {
      for (const child of node.children) walk(child);
      return;
    }

    const info: SymbolInfo = {
      name,
      kind,
      path: filePath,
      range: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
      },
      signature: extractSignature(source, node),
      docstring: getLeadingComment(node) ?? undefined,
      visibility: "public",
      parent: getParentName(node) ?? undefined,
      isExported: isExported(node),
    };

    symbols.push(info);

    // Key fix: recurse into classes/interfaces (to find methods/fields)
    // but NOT into functions (to avoid nested defs)
    if (kind === "function") return;
    for (const child of node.children) walk(child);
  }

  walk(tree.rootNode);
  return symbols;
}

export async function parseFile(filePath: string, source: string): Promise<Tree | null> {
  const langName = getLanguageForFile(filePath);
  if (!langName) return null;

  try {
    await ensureInit();
    const language = await loadLanguage(langName);
    const parser = new Parser();
    parser.setLanguage(language);
    return parser.parse(source);
  } catch (err) {
    console.error(`[symbols] Failed to parse ${filePath}:`, err);
    return null;
  }
}

export async function extractFileSymbols(filePath: string, source: string): Promise<SymbolInfo[]> {
  const tree = await parseFile(filePath, source);
  if (!tree) return [];
  try {
    return await extractSymbols(source, tree, filePath);
  } finally {
    tree.delete();
  }
}
