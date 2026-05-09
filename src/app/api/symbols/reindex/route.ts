import { NextResponse } from "next/server";
import { reindexNow } from "@/server/codebase-ingestor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await reindexNow();

  return NextResponse.json({
    indexed: status.symbolCount,
    store: ".baitrage/symbol-map.json",
    status
  });
}

export async function GET() {
  return POST();
}
