import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisSchema = z.object({
  v_strain: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Vocal frustration from transcript CONTENT. 0=calm/neutral, 0.3=mildly annoyed, 0.6=clearly frustrated, 1=raging. Judge by word choice, profanity, repetition of complaints, exasperation. Normal conversation even at high volume is 0."
    ),
  f_micro_expressions: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Facial tension from camera frame. 0=relaxed/neutral, 0.5=tense, 1=visibly angry. If no camera frame is provided, return 0."
    ),
  p_looping: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Prompt repetition from screen frame. 0=fresh/varied prompts, 0.5=similar retries, 1=exact same prompt repeated. If no screen frame, return 0."
    ),
  visiblePrompts: z
    .array(z.string())
    .describe("Last 1-3 visible user prompts extracted from the screen frame. Empty if no screen frame."),
  relevantQuery: z
    .string()
    .describe("One sentence: what is the developer currently trying to accomplish, inferred from all available signals."),
  reason: z
    .string()
    .describe("One sentence explaining your frustration assessment. Be specific about WHAT indicates frustration (or lack of it).")
});

export type ContentAnalysis = z.infer<typeof analysisSchema>;

type AnalyzeRequest = {
  cameraFrame?: string;
  screenFrame?: string;
  transcript?: string;
  activeFilePath?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzeRequest;
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(fallbackAnalysis(body), { status: 200 });
  }

  try {
    const model = process.env.GEMINI_FLASH_MODEL ?? "gemini-2.0-flash";

    // Build multimodal content parts
    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: Uint8Array; mimeType: string }> = [];

    parts.push({
      type: "text" as const,
      text: buildAnalysisPrompt(body)
    });

    if (body.cameraFrame) {
      parts.push({
        type: "image" as const,
        image: Buffer.from(body.cameraFrame, "base64") as unknown as Uint8Array,
        mimeType: "image/jpeg"
      });
    }

    if (body.screenFrame) {
      parts.push({
        type: "image" as const,
        image: Buffer.from(body.screenFrame, "base64") as unknown as Uint8Array,
        mimeType: "image/jpeg"
      });
    }

    const { object } = await generateObject({
      model: google(model),
      schema: analysisSchema,
      messages: [{ role: "user", content: parts }]
    });

    return NextResponse.json(object);
  } catch (error) {
    console.error("[baitrage] Content analysis failed:", error);
    return NextResponse.json(fallbackAnalysis(body), { status: 200 });
  }
}

function buildAnalysisPrompt(body: AnalyzeRequest): string {
  const lines = [
    "You are Baitrage's content analyser. Assess the developer's ACTUAL frustration level from the evidence below.",
    "",
    "CRITICAL RULES:",
    "- HIGH VOLUME does NOT mean frustration. A developer explaining something loudly is NOT frustrated.",
    "- Only score v_strain high if the transcript contains: profanity, repeated complaints about the same issue, exasperation phrases ('nothing works', 'again?!', 'why won't this'), or escalating negativity.",
    "- Normal conversation, even if animated/loud, should score v_strain 0.0–0.15.",
    "- If the transcript is empty or neutral, v_strain MUST be 0.",
    ""
  ];

  if (body.transcript) {
    lines.push(`Developer's recent speech transcript:\n"${body.transcript}"\n`);
  } else {
    lines.push("No speech transcript available.\n");
  }

  if (body.activeFilePath) {
    lines.push(`Active file: ${body.activeFilePath}\n`);
  }

  if (body.cameraFrame) {
    lines.push("A camera frame of the developer's face is attached. Analyse facial expressions for tension or anger.\n");
  }

  if (body.screenFrame) {
    lines.push("A screen frame of the developer's IDE/chat is attached. Extract any visible user prompts and check for repetitive failed attempts.\n");
  }

  lines.push("Return structured JSON only.");
  return lines.join("\n");
}

function fallbackAnalysis(body: AnalyzeRequest): ContentAnalysis {
  // Very conservative fallback — no AI means low confidence
  const hasAngryWords = body.transcript
    ? /(fuck|shit|damn|broken|not working|again|why won't|hate)/i.test(body.transcript)
    : false;

  return {
    v_strain: hasAngryWords ? 0.45 : 0,
    f_micro_expressions: 0,
    p_looping: 0,
    visiblePrompts: [],
    relevantQuery: body.activeFilePath
      ? `Working on ${body.activeFilePath}`
      : "Unable to determine current task without AI analysis.",
    reason: hasAngryWords
      ? "Frustration keywords detected in transcript (local fallback)."
      : "No frustration signals detected (local fallback — AI analysis unavailable)."
  };
}
