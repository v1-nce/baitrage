import chokidar, { type FSWatcher } from "chokidar";
import { promises as fs } from "fs";
import path from "path";
import type { CodebaseIngestionStatus } from "@/lib/types";
import { mapWorkspaceSymbols } from "@/server/symbol-mapper";
import { getWorkspaceRoot } from "@/server/cursor-context";

const STATE_FILE = ".baitrage/ingestion-state.json";
const WATCH_PATHS = ["src", "app", "pages"];
const WATCHED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED = /(^|[/\\])(\.(git|next|baitrage)|node_modules|dist|out)([/\\]|$)/;

type IngestorState = {
  status: CodebaseIngestionStatus;
  watcher: FSWatcher | null;
  debounce: NodeJS.Timeout | null;
  indexing: boolean;
};

const GLOBAL_KEY = "__baitrageCodebaseIngestor";
const globalStore = globalThis as typeof globalThis & { [GLOBAL_KEY]?: IngestorState };

function store(): IngestorState {
  globalStore[GLOBAL_KEY] ??= {
    status: { running: false, state: "idle", symbolCount: 0, recentFiles: [] },
    watcher: null,
    debounce: null,
    indexing: false,
  };
  return globalStore[GLOBAL_KEY];
}

export async function startCodebaseIngestion(root = getWorkspaceRoot()) {
  const s = store();
  const persisted = await readPersistedStatus(root);
  if (persisted && s.status.state === "idle") s.status = persisted;

  if (!s.watcher) {
    s.watcher = chokidar.watch(WATCH_PATHS, {
      cwd: root,
      ignored: (p) => IGNORED.test(p) || isUnwatched(p),
      ignoreInitial: true,
      persistent: true,
    });
    s.watcher.on("all", (_event, p) => queueReindex(p));
  }

  s.status = { ...s.status, running: true };
  if (shouldRefresh(s.status)) void reindexNow(root);
  return s.status;
}

export async function getCodebaseIngestionStatus(root = getWorkspaceRoot()) {
  const s = store();
  if (s.status.state === "idle") {
    const persisted = await readPersistedStatus(root);
    if (persisted) s.status = persisted;
  }
  return s.status;
}

export async function reindexNow(root = getWorkspaceRoot()) {
  const s = store();
  if (s.indexing) return s.status;

  s.indexing = true;
  s.status = { ...s.status, running: true, state: "indexing", error: undefined };

  try {
    const symbols = await mapWorkspaceSymbols(root);
    s.status = { ...s.status, running: true, state: "ready", symbolCount: symbols.length, lastIndexedAt: new Date().toISOString() };
  } catch (e) {
    s.status = { ...s.status, state: "error", error: e instanceof Error ? e.message : "Codebase indexing failed" };
  } finally {
    s.indexing = false;
    await persistStatus(root, s.status);
  }
  return s.status;
}

function isUnwatched(p: string) {
  const ext = path.extname(p);
  return Boolean(ext && !WATCHED_EXTENSIONS.has(ext));
}

function queueReindex(filePath: string) {
  const s = store();
  const normalized = filePath.replace(/\\/g, "/");
  s.status = {
    ...s.status,
    running: true,
    state: "indexing",
    lastEventAt: new Date().toISOString(),
    recentFiles: [normalized, ...s.status.recentFiles.filter((f) => f !== normalized)].slice(0, 8),
  };
  if (s.debounce) clearTimeout(s.debounce);
  s.debounce = setTimeout(() => void reindexNow(), 500);
}

async function persistStatus(root: string, status: CodebaseIngestionStatus) {
  const p = path.resolve(root, STATE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(status, null, 2), "utf8");
}

async function readPersistedStatus(root: string) {
  try {
    return JSON.parse(await fs.readFile(path.resolve(root, STATE_FILE), "utf8")) as CodebaseIngestionStatus;
  } catch {
    return null;
  }
}

function shouldRefresh(status: CodebaseIngestionStatus) {
  if (status.state === "indexing") return false;
  if (status.state === "idle" || status.state === "error" || status.symbolCount === 0) return true;
  if (!status.lastIndexedAt) return true;
  return Date.now() - new Date(status.lastIndexedAt).getTime() > 30_000;
}
