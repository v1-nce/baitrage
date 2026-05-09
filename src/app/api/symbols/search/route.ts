import { NextResponse } from "next/server";
import { searchSymbols } from "@/server/symbol-mapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { query?: string; limit?: number };
  const symbols = await searchSymbols(body.query ?? "", body.limit ?? 8);

  return NextResponse.json({ symbols });
}
