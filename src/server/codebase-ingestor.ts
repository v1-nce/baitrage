import chokidar, { type FSWatcher } from "chokidar";
import { promises as fs } from "fs";
import path from "path";
import type { CodebaseIngestionStatus } from "@/lib/ingestion-types";
import { mapWorkspaceSymbols } from "@/server/symbol-mapper";

const STATE_FILE = ".baitrage/ingestion-state.json";
const WATCH_PATHS = ["src", "app", "pages"];
const WATCHED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED = /(^|[/\\])(\.git|\.next|\.baitrage|node_modules|dist|out)([/\\]|$)/;

type IngestorState = {
  status: CodebaseIngestionStatus;
  watcher: FSWatcher | null;
  debounce: NodeJS.Timeout | null;
  indexing: boolean;
};

const globalKey = "__baitrageCodebaseIngestor";
const globalStore = globalThis as typeof globalThis & {
  [globalKey]?: IngestorState;
};

function store(): IngestorState {
  globalStore[globalKey] ??= {
    status: {
      running: false,
      state: "idle",
      symbolCount: 0,
      recentFiles: []
    },
    watcher: null,
    debounce: null,
    indexing: false
  };

  return globalStore[globalKey];
}

export async function startCodebaseIngestion(root = process.cwd()) {
  const ingestor = store();
  const persisted = await readPersistedStatus(root);
  if (persisted && ingestor.status.state === "idle") {
    ingestor.status = persisted;
  }

  if (!ingestor.watcher) {
    ingestor.watcher = chokidar.watch(WATCH_PATHS, {
      cwd: root,
      ignored: (filePath) => IGNORED.test(filePath) || isUnwatchedFile(filePath),
      ignoreInitial: true,
      persistent: true
    });

    ingestor.watcher.on("all", (_event, filePath) => {
      queueReindex(filePath);
    });
  }

  ingestor.status = {
    ...ingestor.status,
    running: true
  };

  if (shouldRefreshInBackground(ingestor.status)) {
    void reindexNow(root);
  }

  return ingestor.status;
}

function isUnwatchedFile(filePath: string) {
  const extension = path.extname(filePath);
  return Boolean(extension && !WATCHED_EXTENSIONS.has(extension));
}

export async function getCodebaseIngestionStatus(root = process.cwd()) {
  const ingestor = store();
  if (ingestor.status.state === "idle") {
    const persisted = await readPersistedStatus(root);
    if (persisted) {
      ingestor.status = persisted;
    }
  }

  return ingestor.status;
}

export async function reindexNow(root = process.cwd()) {
  const ingestor = store();
  if (ingestor.indexing) {
    return ingestor.status;
  }

  ingestor.indexing = true;
  ingestor.status = {
    ...ingestor.status,
    running: true,
    state: "indexing",
    error: undefined
  };

  try {
    const symbols = await mapWorkspaceSymbols(root);
    ingestor.status = {
      ...ingestor.status,
      running: true,
      state: "ready",
      symbolCount: symbols.length,
      lastIndexedAt: new Date().toISOString()
    };
  } catch (error) {
    ingestor.status = {
      ...ingestor.status,
      state: "error",
      error: error instanceof Error ? error.message : "Codebase indexing failed"
    };
  } finally {
    ingestor.indexing = false;
    await persistStatus(root, ingestor.status);
  }

  return ingestor.status;
}

function queueReindex(filePath: string) {
  const ingestor = store();
  const normalized = filePath.replace(/\\/g, "/");
  ingestor.status = {
    ...ingestor.status,
    running: true,
    state: "indexing",
    lastEventAt: new Date().toISOString(),
    recentFiles: [normalized, ...ingestor.status.recentFiles.filter((file) => file !== normalized)].slice(0, 8)
  };

  if (ingestor.debounce) {
    clearTimeout(ingestor.debounce);
  }

  ingestor.debounce = setTimeout(() => {
    void reindexNow();
  }, 500);
}

async function persistStatus(root: string, status: CodebaseIngestionStatus) {
  const filePath = path.resolve(root, STATE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(status, null, 2), "utf8");
}

async function readPersistedStatus(root: string) {
  try {
    const raw = await fs.readFile(path.resolve(root, STATE_FILE), "utf8");
    return JSON.parse(raw) as CodebaseIngestionStatus;
  } catch {
    return null;
  }
}

function shouldRefreshInBackground(status: CodebaseIngestionStatus) {
  if (status.state === "indexing") {
    return false;
  }

  if (status.state === "idle" || status.state === "error" || status.symbolCount === 0) {
    return true;
  }

  if (!status.lastIndexedAt) {
    return true;
  }

  return Date.now() - new Date(status.lastIndexedAt).getTime() > 30000;
}
