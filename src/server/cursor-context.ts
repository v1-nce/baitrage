import { promises as fs } from "fs";
import path from "path";
import type { ActiveFileContext } from "@/lib/types";

type CursorContextPayload = Partial<ActiveFileContext> & { filePath?: string };

const DEFAULT_CONTEXT_FILE = ".cursor/baitrage-context.json";

export function getWorkspaceRoot(): string {
  if (process.env.TARGET_WORKSPACE) {
    return path.resolve(process.cwd(), process.env.TARGET_WORKSPACE);
  }
  return process.cwd();
}

export async function readCursorActiveFile(): Promise<ActiveFileContext | null> {
  const contextPath = process.env.BAITRAGE_CONTEXT_FILE ?? DEFAULT_CONTEXT_FILE;

  try {
    const raw = await fs.readFile(path.resolve(getWorkspaceRoot(), contextPath), "utf8");
    const payload = JSON.parse(raw) as CursorContextPayload;
    const filePath = payload.path ?? payload.filePath;
    if (!filePath) return null;

    return {
      path: filePath,
      language: payload.language,
      content: payload.content,
      cursor: payload.cursor,
      workspaceRoot: getWorkspaceRoot(),
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
