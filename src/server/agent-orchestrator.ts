import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import type {
  AgentTrace,
  BaitrageAgentRequest,
  BaitrageAgentResult,
  CodebaseIngestionStatus,
  DeveloperIntent,
  RageDecision,
  SymbolSearchResult,
} from "@/lib/types";
import { RAGE_THRESHOLD } from "@/lib/frustration-evaluator";
import { getCodebaseIngestionStatus } from "@/server/codebase-ingestor";
import { readLedger } from "@/server/local-ledger";
import { searchSymbols } from "@/server/symbol-mapper";

const outputSchema = z.object({
  advice: z.string().min(12).max(220),
  optimisedPrompt: z.string().min(40),
  confidence: z.number().min(0).max(1),
});

export async function orchestrateBaitrageAgents(request: BaitrageAgentRequest): Promise<BaitrageAgentResult> {
  const trace: AgentTrace[] = [];
  const t0 = performance.now();

  // Phase 1: all independent work in parallel
  const seedIntent = inferIntent(request, []);
  const [ledger, ingestion, symbols, decision] = await Promise.all([
    readLedger(),
    getCodebaseIngestionStatus(),
    searchSymbols(seedIntent.query, 10),
    Promise.resolve(runRageSentinel(request)),
  ]);

  trace.push({ agent: "seed", model: "local", durationMs: Math.round(performance.now() - t0), output: summarize(seedIntent) });

  // Phase 2: refine intent with symbols, then synthesize prompt
  const intent = inferIntent(request, symbols);
  const prompts = normalizePrompts(request.visiblePrompts, request.evaluation.visiblePrompts);
  const t1 = performance.now();

  const { prompt, advice, source } = await createPrompt({ request, decision, intent, ingestion, symbols });
  trace.push({ agent: "prompt-architect", model: modelName(), durationMs: Math.round(performance.now() - t1), output: summarize({ advice, source }) });

  return {
    advice: advice ?? createAdvice(decision, intent, ingestion, symbols),
    prompt,
    summary: advice ?? createAdvice(decision, intent, ingestion, symbols),
    symbols,
    visiblePrompts: prompts,
    source,
    createdAt: new Date().toISOString(),
    decision,
    intent,
    ingestion,
    ledger,
    trace,
  };
}

/* ---- Rage Sentinel ---- */

function runRageSentinel(req: BaitrageAgentRequest): RageDecision {
  const c = req.evaluation.coefficient;
  const hasLoop = req.evaluation.signals.pLooping > 0.3;
  const action = c > RAGE_THRESHOLD ? "lockout" : c > 0.15 || hasLoop ? "warn" : "observe";
  return {
    action,
    coefficient: c,
    urgency: action === "lockout" ? "high" : action === "warn" ? "medium" : "low",
    reason: req.evaluation.reason,
  };
}

/* ---- Intent Miner ---- */

function inferIntent(req: BaitrageAgentRequest, symbols: SymbolSearchResult[]): DeveloperIntent {
  const prompts = normalizePrompts(req.visiblePrompts, req.evaluation.visiblePrompts);
  const lastPrompt = prompts.at(-1) ?? req.evaluation.relevantQuery;
  const activePath = req.activeFile?.path ?? "the active file";
  const t = req.transcript ?? "";
  const symbolHint = symbols.slice(0, 4).map((s) => s.name).join(", ");

  return {
    task: t ? t.slice(-200) : lastPrompt || `Resolve the current issue in ${activePath}`,
    failureMode: detectFailureMode([t, ...prompts].join(" ")),
    query: [t.slice(-100), lastPrompt, activePath, symbolHint].filter(Boolean).join(" "),
  };
}

/* ---- Prompt Architect ---- */

async function createPrompt(ctx: {
  request: BaitrageAgentRequest;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  const fallback = buildFallbackPrompt(ctx);
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { prompt: fallback, source: "fallback" as const, advice: undefined };
  }

  try {
    const { object } = await generateObject({
      model: google(modelName()),
      schema: outputSchema,
      system: "You are Baitrage's Prompt Architect. Convert failed AI coding loops into one calm, specific, codebase-aware prompt. Be concise and operational.",
      prompt: buildOrchestrationPrompt(ctx),
    });
    return { prompt: object.optimisedPrompt.trim(), advice: object.advice.trim(), source: "ai" as const };
  } catch {
    return { prompt: fallback, source: "fallback" as const, advice: undefined };
  }
}

/* ---- Advice (deterministic fallback only) ---- */

function createAdvice(decision: RageDecision, intent: DeveloperIntent, ingestion: CodebaseIngestionStatus, symbols: SymbolSearchResult[]) {
  if (decision.action === "lockout")
    return `Pause. Baitrage found a ${intent.failureMode} loop and ${symbols.length} relevant symbols; use the rewritten prompt.`;
  if (ingestion.state !== "ready")
    return "Hold on — the local codebase map is still indexing, so the next prompt may lack project context.";
  return `Keep it narrow: ask for the smallest verified change around ${symbols[0]?.name ?? "the active code path"}.`;
}

/* ---- Prompt Templates ---- */

function buildFallbackPrompt(ctx: {
  request: BaitrageAgentRequest;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  const prompts = normalizePrompts(ctx.request.visiblePrompts, ctx.request.evaluation.visiblePrompts);
  const symbolLines = ctx.symbols
    .slice(0, 8)
    .map((s) => `- ${s.kind} ${s.name} at ${s.filePath}:${s.line}: ${s.signature}`)
    .join("\n");

  return [
    "I am stuck in a coding issue. Help me resolve it calmly and systematically using the code context below.",
    "",
    `What I was saying/doing: ${ctx.request.transcript || ctx.intent.task || "infer from the context below"}`,
    `Observed failure mode: ${ctx.intent.failureMode}`,
    ctx.request.evaluation.agentContext ? `AI Agent/Tool used: ${ctx.request.evaluation.agentContext}` : "AI Agent/Tool used: unknown",
    ctx.request.evaluation.workspaceName ? `Workspace/Project: ${ctx.request.evaluation.workspaceName}` : "Workspace/Project: unknown",
    ctx.request.activeFile ? `Active file: ${ctx.request.activeFile.path}` : "Active file: unknown",
    `Codebase: ${ctx.ingestion.symbolCount} symbols indexed`,
    "",
    "Last visible prompts:",
    prompts.map((p, i) => `${i + 1}. ${p}`).join("\n") || "- Not available from screen share yet",
    "",
    "Relevant code symbols:",
    symbolLines || "- No matching symbols found yet",
    "",
    "Please identify the root cause, reference the relevant files/functions, and propose the smallest safe change with a verification step.",
  ].join("\n");
}

function buildOrchestrationPrompt(ctx: {
  request: BaitrageAgentRequest;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  symbols: SymbolSearchResult[];
}) {
  return [
    "Return structured JSON only.",
    "",
    "Advice: one actionable sentence (<220 chars) about what the developer should do RIGHT NOW.",
    "Optimised prompt: a calm, specific prompt the developer can paste into their AI coding tool.",
    "The prompt MUST reference the developer's actual problem from their speech/screen, not generic advice.",
    "",
    "Developer's recent speech:",
    ctx.request.transcript || "(no transcript available)",
    "",
    "Rage decision:",
    JSON.stringify(ctx.decision),
    "",
    "Developer intent:",
    JSON.stringify(ctx.intent),
    "",
    "AI Agent/Tool used:",
    ctx.request.evaluation.agentContext || "unknown",
    "",
    "Workspace/Project Name:",
    ctx.request.evaluation.workspaceName || "unknown",
    "",
    "Active file:",
    ctx.request.activeFile ? `${ctx.request.activeFile.path}:${ctx.request.activeFile.cursor?.line ?? 1}` : "unknown",
    "",
    "Visible prompts from screen:",
    normalizePrompts(ctx.request.visiblePrompts, ctx.request.evaluation.visiblePrompts).join("\n") || "none",
    "",
    "Relevant codebase symbols:",
    ctx.symbols.map((s) => `${s.kind} ${s.name} ${s.filePath}:${s.line} ${s.signature}`).join("\n") || "none",
  ].join("\n");
}

/* ---- Utilities ---- */

function normalizePrompts(...groups: string[][]) {
  return groups.flat().map((p) => p.trim()).filter(Boolean).slice(-3);
}

function detectFailureMode(text: string) {
  const l = text.toLowerCase();
  if (/(again|still|same|keeps|loop|not working|doesn't work)/.test(l)) return "repeated failed fix";
  if (/(type|typescript|compile|build|lint)/.test(l)) return "compile or type error";
  if (/(api|request|response|route|server)/.test(l)) return "integration or API mismatch";
  return "underspecified coding request";
}

function modelName() {
  return process.env.GEMINI_PRO_MODEL ?? "gemini-3.1-pro-preview";
}

function summarize(v: unknown) {
  return JSON.stringify(v).slice(0, 240);
}
