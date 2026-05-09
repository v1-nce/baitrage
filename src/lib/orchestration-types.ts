import type { FrustrationEvaluation } from "@/lib/frustration-evaluator";
import type { CodebaseIngestionStatus } from "@/lib/ingestion-types";
import type { RageLedger } from "@/lib/ledger-types";
import type { SymbolSearchResult } from "@/lib/symbol-types";
import type { ActiveFileContext } from "@/hooks/useMultimodal";

export type BaitrageAgentRequest = {
  activeFile: ActiveFileContext | null;
  evaluation: FrustrationEvaluation;
  transcript?: string;
  visiblePrompts: string[];
};

export type RageDecision = {
  action: "observe" | "warn" | "lockout";
  coefficient: number;
  reason: string;
  urgency: "low" | "medium" | "high";
};

export type DeveloperIntent = {
  task: string;
  failureMode: string;
  query: string;
};

export type AgentTrace = {
  agent: string;
  durationMs: number;
  model: "local" | string;
  output: string;
};

export type BaitrageAgentResult = {
  advice: string;
  prompt: string;
  summary: string;
  symbols: SymbolSearchResult[];
  visiblePrompts: string[];
  source: "ai" | "fallback";
  createdAt: string;
  decision: RageDecision;
  intent: DeveloperIntent;
  ingestion: CodebaseIngestionStatus;
  ledger: RageLedger;
  trace: AgentTrace[];
};
