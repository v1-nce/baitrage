import { NextResponse } from "next/server";
import type { RageLedgerState } from "@/lib/types";
import { readLedger, writeLedger } from "@/server/local-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readLedger());
}

export async function POST(request: Request) {
  const state = (await request.json()) as RageLedgerState;
  if (!state.updatedAt) state.updatedAt = new Date().toISOString();
  return NextResponse.json({ stored: true, ledger: await writeLedger(state) });
}
