import { NextResponse } from "next/server";
import {
  getCodebaseIngestionStatus,
  reindexNow,
  startCodebaseIngestion
} from "@/server/codebase-ingestor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCodebaseIngestionStatus());
}

export async function POST() {
  return NextResponse.json(await startCodebaseIngestion());
}

export async function PUT() {
  return NextResponse.json(await reindexNow());
}
