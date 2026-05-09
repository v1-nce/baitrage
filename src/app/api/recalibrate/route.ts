import { NextResponse } from "next/server";
import type { FrustrationEvaluation } from "@/lib/frustration-evaluator";
import type { ActiveFileContext } from "@/hooks/useMultimodal";
import { orchestrateBaitrageAgents } from "@/server/agent-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    activeFile: ActiveFileContext | null;
    evaluation: FrustrationEvaluation;
    transcript?: string;
    visiblePrompts: string[];
  };
  const pivot = await orchestrateBaitrageAgents({
    activeFile: body.activeFile,
    evaluation: body.evaluation,
    transcript: body.transcript,
    visiblePrompts: body.visiblePrompts.slice(-3)
  });

  return NextResponse.json(pivot);
}
