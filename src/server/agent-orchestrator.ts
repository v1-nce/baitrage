import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import type {
  AgentTrace,
  BaitrageAgentRequest,
  BaitrageAgentResult,
  DeveloperIntent,
  RageDecision
} from "@/lib/orchestration-types";
import { RAGE_THRESHOLD } from "@/lib/frustration-evaluator";
import type { CodebaseIngestionStatus } from "@/lib/ingestion-types";
import type { SymbolSearchResult } from "@/lib/symbol-types";
import { getCodebaseIngestionStatus } from "@/server/codebase-ingestor";
import { readLedger } from "@/server/local-ledger";
import { searchSymbols } from "@/server/symbol-mapper";

const outputSchema = z.object({
  advice: z.string().min(12).max(220),
  optimisedPrompt: z.string().min(40),
  confidence: z.number().min(0).max(1)
});

export async function orchestrateBaitrageAgents(
  request: BaitrageAgentRequest
): Promise<BaitrageAgentResult> {
  const trace: AgentTrace[] = [];
  const decision = timed("rage-sentinel", "local", trace, () => runRageSentinel(request));
  const seedIntent = timed("intent-miner", "local", trace, () => inferIntent(request, []));

  const [ledger, ingestion, symbols] = await Promise.all([
    timedAsync("ledger-reader", "local", trace, () => readLedger()),
    timedAsync("codebase-scout", "local", trace, () => getCodebaseIngestionStatus()),
    timedAsync("symbol-scout", "local", trace, () => searchSymbols(seedIntent.query, 10))
  ]);
  const intent = timed("intent-miner/refine", "local", trace, () => inferIntent(request, symbols));

  const [advice, promptResult] = await Promise.all([
    timedAsync("advice-coach", "local", trace, async () =>
      createAdvice({ decision, intent, ingestion, symbols })
    ),
    timedAsync("prompt-architect", modelName(), trace, () =>
      createPrompt({ request, decision, intent, ingestion, symbols })
    )
  ]);

  return {
    advice: promptResult.advice ?? advice,
    prompt: promptResult.prompt,
    summary: promptResult.advice ?? advice,
    symbols,
    visiblePrompts: normalizePrompts(request.visiblePrompts, request.evaluation.visiblePrompts),
    source: promptResult.source,
    createdAt: new Date().toISOString(),
    decision,
    intent,
    ingestion,
    ledger,
    trace
  };
}

function runRageSentinel(request: BaitrageAgentRequest): RageDecision {
  const coefficient = request.evaluation.coefficient;
  const hasLoop = request.evaluation.signals.pLooping > 0.30;
  const action = coefficient > RAGE_THRESHOLD ? "lockout" : coefficient > 0.15 || hasLoop ? "warn" : "observe";

  return {
    action,
    coefficient,
    urgency: action === "lockout" ? "high" : action === "warn" ? "medium" : "low",
    reason: request.evaluation.reason
  };
}

function inferIntent(request: BaitrageAgentRequest, symbols: SymbolSearchResult[]): DeveloperIntent {
  const prompts = normalizePrompts(request.visiblePrompts, request.evaluation.visiblePrompts);
  const lastPrompt = prompts.at(-1) ?? request.evaluation.relevantQuery;
  const activePath = request.activeFile?.path ?? "the active file";
  const transcript = request.transcript ?? "";
  const symbolHint = symbols
    .slice(0, 4)
    .map((symbol) => symbol.name)
    .join(", ");

  // Prefer transcript for task inference if available
  const inferredTask = transcript
    ? transcript.slice(-200)
    : lastPrompt || `Resolve the current issue in ${activePath}`;

  return {
    task: inferredTask,
    failureMode: detectFailureMode([transcript, ...prompts].join(" ")),
    query: [transcript.slice(-100), lastPrompt, activePath, symbolHint].filter(Boolean).join(" ")
  };
}

async function createPrompt({
  request,
  decision,
  intent,
  ingestion,
  symbols
}: {
  request: BaitrageAgentRequest;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  const fallback = createFallbackPrompt({ request, decision, intent, ingestion, symbols });
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { prompt: fallback, source: "fallback" as const };
  }

  try {
    const { object } = await generateObject({
      model: google(modelName()),
      schema: outputSchema,
      system:
        "You are Baitrage's Prompt Architect. Convert failed AI coding loops into one calm, specific, codebase-aware prompt. Be concise and operational.",
      prompt: orchestrationPrompt({ request, decision, intent, ingestion, symbols })
    });

    return {
      prompt: object.optimisedPrompt.trim(),
      advice: object.advice.trim(),
      source: "ai" as const
    };
  } catch {
    return { prompt: fallback, source: "fallback" as const };
  }
}

function createAdvice({
  decision,
  intent,
  ingestion,
  symbols
}: {
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  if (decision.action === "lockout") {
    return `Pause send. Baitrage found a ${intent.failureMode} loop and ${symbols.length} relevant symbols; use the rewritten prompt.`;
  }

  if (ingestion.state !== "ready") {
    return "Hold one beat. The local codebase map is still indexing, so the next prompt may lack current project context.";
  }

  return `Keep it narrow: ask for the smallest verified change around ${symbols[0]?.name ?? "the active code path"}.`;
}

function createFallbackPrompt({
  request,
  decision,
  intent,
  ingestion,
  symbols
}: {
  request: BaitrageAgentRequest;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  const prompts = normalizePrompts(request.visiblePrompts, request.evaluation.visiblePrompts);
  const symbolLines = symbols
    .slice(0, 8)
    .map((symbol) => `- ${symbol.kind} ${symbol.name} at ${symbol.filePath}:${symbol.line}: ${symbol.signature}`)
    .join("\n");

  return [
    "I am stuck in a coding issue. Help me resolve it calmly and systematically using the code context below.",
    "",
    `What I was saying/doing: ${request.transcript || intent.task || "infer from the context below"}`,
    `Observed failure mode: ${intent.failureMode}`,
    request.activeFile ? `Active file: ${request.activeFile.path}` : "Active file: unknown",
    `Codebase: ${ingestion.symbolCount} symbols indexed`,
    "",
    "Last visible prompts:",
    prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n") || "- Not available from screen share yet",
    "",
    "Relevant code symbols:",
    symbolLines || "- No matching symbols found yet",
    "",
    "Please identify the root cause based on what I described above, reference the relevant files/functions, and propose the smallest safe change with a verification step."
  ].join("\n");
}

function orchestrationPrompt(args: {
  request: BaitrageAgentRequest;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  return [
    "Return structured JSON only.",
    "",
    "Advice: one actionable sentence (<220 chars) about what the developer should do RIGHT NOW based on their speech and code context.",
    "Optimised prompt: a calm, specific prompt the developer can paste directly into their AI coding tool (Claude, Cursor, Codex).",
    "The prompt MUST reference the developer's actual problem from their speech/screen, not generic advice.",
    "",
    "Developer's recent speech:",
    args.request.transcript || "(no transcript available)",
    "",
    "Rage decision:",
    JSON.stringify(args.decision),
    "",
    "Developer intent:",
    JSON.stringify(args.intent),
    "",
    "Active file:",
    args.request.activeFile
      ? `${args.request.activeFile.path}:${args.request.activeFile.cursor?.line ?? 1}`
      : "unknown",
    "",
    "Visible prompts from screen:",
    normalizePrompts(args.request.visiblePrompts, args.request.evaluation.visiblePrompts).join("\n") ||
      "none",
    "",
    "Relevant codebase symbols:",
    args.symbols
      .map((symbol) => `${symbol.kind} ${symbol.name} ${symbol.filePath}:${symbol.line} ${symbol.signature}`)
      .join("\n") || "none"
  ].join("\n");
}

function normalizePrompts(...groups: string[][]) {
  return groups
    .flat()
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(-3);
}

function detectFailureMode(text: string) {
  const lower = text.toLowerCase();
  if (/(again|still|same|keeps|loop|not working|doesn't work)/.test(lower)) {
    return "repeated failed fix";
  }

  if (/(type|typescript|compile|build|lint)/.test(lower)) {
    return "compile or type error";
  }

  if (/(api|request|response|route|server)/.test(lower)) {
    return "integration or API mismatch";
  }

  return "underspecified coding request";
}

function modelName() {
  return process.env.GEMINI_PRO_MODEL ?? "gemini-3.1-pro-preview";
}

function timed<T>(agent: string, model: AgentTrace["model"], trace: AgentTrace[], run: () => T): T {
  const started = performance.now();
  const output = run();
  trace.push({
    agent,
    model,
    durationMs: Math.round(performance.now() - started),
    output: summarize(output)
  });
  return output;
}

async function timedAsync<T>(
  agent: string,
  model: AgentTrace["model"],
  trace: AgentTrace[],
  run: () => Promise<T>
): Promise<T> {
  const started = performance.now();
  const output = await run();
  trace.push({
    agent,
    model,
    durationMs: Math.round(performance.now() - started),
    output: summarize(output)
  });
  return output;
}

function summarize(value: unknown) {
  return JSON.stringify(value).slice(0, 240);
}
