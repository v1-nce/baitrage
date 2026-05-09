import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the authenticated Gemini Live WebSocket URL.
 *
 * Production: exchange the API key for an ephemeral OAuth token.
 * Hackathon:  append the API key as a query parameter, which the
 *             Gemini BidiGenerateContent endpoint accepts.
 */
export function GET() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not set" },
      { status: 500 }
    );
  }

  const model = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.0-flash-live-001";
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

  return NextResponse.json({ wsUrl, model });
}
