import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisSchema = z.object({
  v_strain: z.number().min(0).max(1).describe(
    "Vocal frustration from transcript CONTENT. 0=calm, 0.3=mildly annoyed, 0.6=clearly frustrated, 1=raging. Judge by word choice, profanity, repetition. Normal conversation even if loud is 0."
  ),
  f_micro_expressions: z.number().min(0).max(1).describe(
    "Facial tension from camera frame. 0=relaxed, 0.5=tense, 1=visibly angry. Return 0 if no camera frame."
  ),
  p_looping: z.number().min(0).max(1).describe(
    "Prompt repetition from screen frame. 0=fresh prompts, 0.5=similar retries, 1=exact repeats. Return 0 if no screen frame."
  ),
  visiblePrompts: z.array(z.string()).describe("Last 1-3 visible user prompts from the screen. Empty if no screen."),
  relevantQuery: z.string().describe("One sentence: what the developer is currently trying to accomplish."),
  agentContext: z.string().optional().describe("The AI agent or tool the user is interacting with (e.g. Cursor, GitHub Copilot, ChatGPT, Claude) if visible on screen."),
  workspaceName: z.string().optional().describe("The name of the project, repository, or workspace the user is currently working in, if visible on screen."),
  reason: z.string().describe("One sentence explaining your frustration assessment with specific evidence."),
});

type AnalyzeRequest = {
  cameraFrame?: string;
  screenFrame?: string;
  transcript?: string;
  activeFilePath?: string;
  recentScores?: number[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzeRequest;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json(fallbackAnalysis(body));
  }

  try {
    const model = process.env.GEMINI_FLASH_MODEL ?? "gemini-2.0-flash";
    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: Uint8Array; mimeType: string }> = [];

    parts.push({ type: "text" as const, text: buildPrompt(body) });

    if (body.cameraFrame) {
      parts.push({ type: "image" as const, image: Buffer.from(body.cameraFrame, "base64") as unknown as Uint8Array, mimeType: "image/jpeg" });
    }
    if (body.screenFrame) {
      parts.push({ type: "image" as const, image: Buffer.from(body.screenFrame, "base64") as unknown as Uint8Array, mimeType: "image/jpeg" });
    }

    const { object } = await generateObject({
      model: google(model),
      schema: analysisSchema,
      messages: [{ role: "user", content: parts }],
    });

    return NextResponse.json(object);
  } catch (err) {
    console.error("[baitrage] analysis error:", err);
    return NextResponse.json(fallbackAnalysis(body));
  }
}

function buildPrompt(body: AnalyzeRequest): string {
  const lines = [
    "You are Baitrage's content analyser. Assess the developer's ACTUAL frustration level.",
    "",
    "CRITICAL RULES:",
    "- HIGH VOLUME ≠ frustration. Only score v_strain high for: profanity, repeated complaints, exasperation phrases ('nothing works', 'again?!', 'why won't this'), escalating negativity.",
    "- Normal conversation, even if animated, scores v_strain 0.0–0.15.",
    "- Empty or neutral transcript → v_strain MUST be 0.",
    "",
  ];

  if (body.transcript) {
    lines.push(`Developer's recent speech:\n"${body.transcript}"\n`);
  } else {
    lines.push("No speech transcript available.\n");
  }

  if (body.activeFilePath) lines.push(`Active file: ${body.activeFilePath}\n`);
  if (body.cameraFrame) lines.push("A camera frame is attached. Analyse facial expressions for tension.\n");
  if (body.screenFrame) lines.push("A screen frame is attached. Extract visible prompts, check for repetitive failed attempts, identify the AI agent/tool being used, and identify the workspace/project name if visible.\n");

  // Trajectory context: give the model recent frustration scores
  if (body.recentScores?.length) {
    const trajectory = body.recentScores.map((s) => s.toFixed(2)).join(" → ");
    lines.push(`Recent frustration trajectory: ${trajectory}`);
    lines.push("If the trajectory is rising, weight your assessment slightly higher. If falling, weight lower.\n");
  }

  lines.push("Return structured JSON only.");
  return lines.join("\n");
}

function fallbackAnalysis(body: AnalyzeRequest) {
  const hasAngryWords = body.transcript
    ? /(fuck|shit|damn|broken|not working|again|why won't|hate)/i.test(body.transcript)
    : false;

  return {
    v_strain: hasAngryWords ? 0.45 : 0,
    f_micro_expressions: 0,
    p_looping: 0,
    visiblePrompts: [] as string[],
    relevantQuery: body.activeFilePath ? `Working on ${body.activeFilePath}` : "Unable to determine current task.",
    agentContext: undefined,
    workspaceName: undefined,
    reason: hasAngryWords
      ? "Frustration keywords detected in transcript (local fallback)."
      : "No frustration signals detected (local fallback).",
  };
}
