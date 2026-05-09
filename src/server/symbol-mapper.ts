import { promises as fs } from "fs";
import path from "path";
import type { CodeSymbol, SymbolSearchResult } from "@/lib/symbol-types";

const DEFAULT_INDEX_FILE = ".cursor/baitrage-indexed-files.txt";
const SYMBOL_CACHE_FILE = ".baitrage/symbol-map.json";
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIRS = new Set([".git", ".next", "node_modules", "dist", "out"]);

export async function mapWorkspaceSymbols(root = process.cwd()) {
  const files = await getCursorIndexedFiles(root);
  const candidates = files.length ? files : await walkSourceFiles(root);
  const symbols: CodeSymbol[] = [];

  for (const filePath of candidates) {
    const absolutePath = path.resolve(root, filePath);
    const extension = path.extname(absolutePath);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      continue;
    }

    try {
      const source = await fs.readFile(absolutePath, "utf8");
      const fileSymbols = extractSymbols(root, absolutePath, source);
      symbols.push(...fileSymbols, fileSummarySymbol(root, absolutePath, source, fileSymbols));
    } catch {
      continue;
    }
  }

  await persistSymbolMap(root, symbols);
  return symbols;
}

export async function searchSymbols(query: string, limit = 8, root = process.cwd()) {
  const symbols = (await readSymbolMap(root)) ?? (await mapWorkspaceSymbols(root));
  const terms = tokenize(query);

  return symbols
    .map<SymbolSearchResult>((symbol) => ({
      ...symbol,
      score: scoreSymbol(symbol, terms)
    }))
    .filter((symbol) => symbol.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function getCursorIndexedFiles(root: string) {
  const indexPath = path.resolve(root, process.env.CURSOR_INDEX_FILE ?? DEFAULT_INDEX_FILE);

  try {
    const raw = await fs.readFile(indexPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => SUPPORTED_EXTENSIONS.has(path.extname(line)));
  } catch {
    return [];
  }
}

async function walkSourceFiles(root: string, directory = root): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          return [];
        }

        return walkSourceFiles(root, absolutePath);
      }

      if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
        return [];
      }

      return [path.relative(root, absolutePath).replace(/\\/g, "/")];
    })
  );

  return files.flat();
}

function extractSymbols(root: string, absolutePath: string, source: string) {
  const filePath = path.relative(root, absolutePath).replace(/\\/g, "/");
  const symbols: CodeSymbol[] = [];
  const patterns: Array<{ kind: string; pattern: RegExp }> = [
    {
      kind: "function",
      pattern:
        /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g
    },
    {
      kind: "function",
      pattern:
        /(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>/g
    },
    {
      kind: "class",
      pattern: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*/g
    },
    {
      kind: "interface",
      pattern: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*/g
    },
    {
      kind: "type",
      pattern: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=[^;\n]+/g
    },
    {
      kind: "enum",
      pattern: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)[^{]*/g
    },
    {
      kind: "variable",
      pattern:
        /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*(?!\s*(?:async\s*)?\()/g
    }
  ];

  for (const { kind, pattern } of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (!name || symbols.some((symbol) => symbol.name === name && symbol.kind === kind)) {
        continue;
      }

      const signature = compactSignature(match[0]);
      const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
      symbols.push({
        id: `${filePath}:${name}:${line}`,
        filePath,
        name,
        kind: kind as CodeSymbol["kind"],
        signature,
        summary: `${kind} ${name} in ${filePath}: ${signature}`,
        line,
        language: path.extname(filePath).replace(".", ""),
        updatedAt: new Date().toISOString()
      });
    }
  }

  return symbols;
}

function fileSummarySymbol(root: string, absolutePath: string, source: string, symbols: CodeSymbol[]): CodeSymbol {
  const filePath = path.relative(root, absolutePath).replace(/\\/g, "/");
  const exportedNames = symbols
    .filter((symbol) => symbol.kind !== "file")
    .map((symbol) => symbol.name)
    .slice(0, 12);

  return {
    id: `${filePath}:file:1`,
    filePath,
    name: path.basename(filePath),
    kind: "file",
    signature: `${source.split(/\r?\n/).length} lines; exports ${exportedNames.join(", ") || "no named symbols"}`,
    summary: `File ${filePath} contains ${symbols.length} extracted symbols: ${exportedNames.join(", ") || "none"}.`,
    line: 1,
    language: path.extname(filePath).replace(".", ""),
    updatedAt: new Date().toISOString()
  };
}

function compactSignature(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*\{[\s\S]*$/, "")
    .slice(0, 240)
    .trim();
}

async function persistSymbolMap(root: string, symbols: CodeSymbol[]) {
  const cachePath = path.resolve(root, SYMBOL_CACHE_FILE);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(symbols, null, 2), "utf8");
}

async function readSymbolMap(root: string) {
  const cachePath = path.resolve(root, SYMBOL_CACHE_FILE);

  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as CodeSymbol[];
  } catch {
    return null;
  }
}

function scoreSymbol(symbol: CodeSymbol, terms: string[]) {
  if (!terms.length) {
    return 1;
  }

  const haystack = `${symbol.name} ${symbol.kind} ${symbol.filePath} ${symbol.summary}`.toLowerCase();
  return terms.reduce((score, term) => {
    if (symbol.name.toLowerCase().includes(term)) {
      return score + 4;
    }

    if (symbol.filePath.toLowerCase().includes(term)) {
      return score + 2;
    }

    return haystack.includes(term) ? score + 1 : score;
  }, 0);
}

function tokenize(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2)
    .slice(0, 20);
}
