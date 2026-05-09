import { promises as fs } from "fs";
import path from "path";
import type { RageLedger, RageLedgerState } from "@/lib/types";
import { getWorkspaceRoot } from "@/server/cursor-context";

const LEDGER_FILE = ".baitrage/rage-ledger.json";
const MAX_HISTORY = 80;

export async function readLedger(root = getWorkspaceRoot()): Promise<RageLedger> {
  try {
    const raw = await fs.readFile(path.resolve(root, LEDGER_FILE), "utf8");
    return JSON.parse(raw) as RageLedger;
  } catch {
    return { latest: null, history: [] };
  }
}

export async function writeLedger(state: RageLedgerState, root = getWorkspaceRoot()) {
  const ledger = await readLedger(root);
  const next: RageLedger = {
    latest: state,
    history: [state, ...ledger.history].slice(0, MAX_HISTORY),
  };
  const filePath = path.resolve(root, LEDGER_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
