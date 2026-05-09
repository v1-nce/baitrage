import { promises as fs } from "fs";
import path from "path";
import type { CodeSymbol, SymbolSearchResult } from "@/lib/types";

import { getWorkspaceRoot } from "@/server/cursor-context";

const DEFAULT_INDEX_FILE = ".cursor/baitrage-indexed-files.txt";
const SYMBOL_CACHE_FILE = ".baitrage/symbol-map.json";
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIRS = new Set([".git", ".next", "node_modules", "dist", "out"]);

export async function mapWorkspaceSymbols(root = getWorkspaceRoot()) {
  const files = await getCursorIndexedFiles(root);
  const candidates = files.length ? files : await walkSourceFiles(root);
  const symbols: CodeSymbol[] = [];

  for (const filePath of candidates) {
    const abs = path.resolve(root, filePath);
    if (!SUPPORTED_EXTENSIONS.has(path.extname(abs))) continue;

    try {
      const source = await fs.readFile(abs, "utf8");
      const extracted = extractSymbols(root, abs, source);
      symbols.push(...extracted, fileSummarySymbol(root, abs, source, extracted));
    } catch {
      continue;
    }
  }

  await persistSymbolMap(root, symbols);
  return symbols;
}

export async function searchSymbols(query: string, limit = 8, root = getWorkspaceRoot()) {
  const symbols = (await readSymbolMap(root)) ?? (await mapWorkspaceSymbols(root));
  const terms = tokenize(query);

  return symbols
    .map<SymbolSearchResult>((s) => ({ ...s, score: scoreSymbol(s, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ---- File discovery ---- */

async function getCursorIndexedFiles(root: string) {
  try {
    const raw = await fs.readFile(path.resolve(root, process.env.CURSOR_INDEX_FILE ?? DEFAULT_INDEX_FILE), "utf8");
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => SUPPORTED_EXTENSIONS.has(path.extname(l)));
  } catch {
    return [];
  }
}

async function walkSourceFiles(root: string, dir = root): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (e) => {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) return IGNORED_DIRS.has(e.name) ? [] : walkSourceFiles(root, abs);
      if (!e.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(e.name))) return [];
      return [path.relative(root, abs).replace(/\\/g, "/")];
    }),
  );
  return files.flat();
}

/* ---- Symbol extraction ---- */

const PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: "function", pattern: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g },
  { kind: "function", pattern: /(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>/g },
  { kind: "class", pattern: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*/g },
  { kind: "interface", pattern: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*/g },
  { kind: "type", pattern: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=[^;\n]+/g },
  { kind: "enum", pattern: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)[^{]*/g },
  { kind: "variable", pattern: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*(?!\s*(?:async\s*)?\()/g },
];

function extractSymbols(root: string, abs: string, source: string) {
  const filePath = path.relative(root, abs).replace(/\\/g, "/");
  const symbols: CodeSymbol[] = [];

  for (const { kind, pattern } of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (!name || symbols.some((s) => s.name === name && s.kind === kind)) continue;

      const sig = compactSignature(match[0]);
      const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
      symbols.push({
        id: `${filePath}:${name}:${line}`,
        filePath,
        name,
        kind: kind as CodeSymbol["kind"],
        signature: sig,
        summary: `${kind} ${name} in ${filePath}: ${sig}`,
        line,
        language: path.extname(filePath).replace(".", ""),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return symbols;
}

function fileSummarySymbol(root: string, abs: string, source: string, symbols: CodeSymbol[]): CodeSymbol {
  const filePath = path.relative(root, abs).replace(/\\/g, "/");
  const names = symbols.filter((s) => s.kind !== "file").map((s) => s.name).slice(0, 12);
  return {
    id: `${filePath}:file:1`,
    filePath,
    name: path.basename(filePath),
    kind: "file",
    signature: `${source.split(/\r?\n/).length} lines; exports ${names.join(", ") || "no named symbols"}`,
    summary: `File ${filePath} contains ${symbols.length} extracted symbols: ${names.join(", ") || "none"}.`,
    line: 1,
    language: path.extname(filePath).replace(".", ""),
    updatedAt: new Date().toISOString(),
  };
}

/* ---- Persistence ---- */

async function persistSymbolMap(root: string, symbols: CodeSymbol[]) {
  const p = path.resolve(root, SYMBOL_CACHE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(symbols, null, 2), "utf8");
}

async function readSymbolMap(root: string) {
  try {
    return JSON.parse(await fs.readFile(path.resolve(root, SYMBOL_CACHE_FILE), "utf8")) as CodeSymbol[];
  } catch {
    return null;
  }
}

/* ---- Scoring ---- */

function scoreSymbol(s: CodeSymbol, terms: string[]) {
  if (!terms.length) return 1;
  const haystack = `${s.name} ${s.kind} ${s.filePath} ${s.summary}`.toLowerCase();
  return terms.reduce((score, term) => {
    if (s.name.toLowerCase().includes(term)) return score + 4;
    if (s.filePath.toLowerCase().includes(term)) return score + 2;
    return haystack.includes(term) ? score + 1 : score;
  }, 0);
}

function tokenize(query: string) {
  return query.toLowerCase().split(/[^a-z0-9_]+/).map((t) => t.trim()).filter((t) => t.length > 2).slice(0, 20);
}

function compactSignature(text: string) {
  return text.replace(/\s+/g, " ").replace(/\s*\{[\s\S]*$/, "").slice(0, 240).trim();
}
