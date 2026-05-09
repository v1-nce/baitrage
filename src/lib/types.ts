/* ------------------------------------------------------------------ */
/*  Baitrage — Shared Type Definitions                                */
/* ------------------------------------------------------------------ */

/* ---- Codebase Ingestion ---- */

export type CodebaseIngestionStatus = {
  running: boolean;
  state: "idle" | "indexing" | "ready" | "error";
  symbolCount: number;
  recentFiles: string[];
  lastEventAt?: string;
  lastIndexedAt?: string;
  error?: string;
};

/* ---- Code Symbols ---- */

export type CodeSymbol = {
  id: string;
  filePath: string;
  name: string;
  kind: "class" | "enum" | "file" | "function" | "interface" | "type" | "variable";
  signature: string;
  summary: string;
  line: number;
  language?: string;
  updatedAt: string;
};

export type SymbolSearchResult = CodeSymbol & { score: number };

/* ---- Rage Ledger ---- */

export type RageLedgerState = {
  activeFilePath?: string;
  advice?: string;
  connectionState: string;
  frustration: number;
  isLocked: boolean;
  isRecalibrating: boolean;
  isScreenSharing: boolean;
  prompt?: string;
  reason?: string;
  updatedAt: string;
};

export type RageLedger = {
  latest: RageLedgerState | null;
  history: RageLedgerState[];
};

/* ---- Active File Context ---- */

export type ActiveFileContext = {
  path: string;
  language?: string;
  content?: string;
  cursor?: { line?: number; column?: number };
  workspaceRoot?: string;
  updatedAt: string;
};

/* ---- Pivot Prompt (output to UI) ---- */

export type PivotPrompt = {
  advice?: string;
  prompt: string;
  summary: string;
  symbols: SymbolSearchResult[];
  visiblePrompts: string[];
  source: "ai" | "fallback";
  createdAt: string;
};

/* ---- Orchestration ---- */

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

/* ---- Frustration Evaluator ---- */

export type FrustrationSignals = {
  vStrain: number;
  fMicroExpressions: number;
  pLooping: number;
};

export type DetectorMessage = {
  frustration?: number;
  locked?: boolean;
  reason?: string;
  relevantQuery?: string;
  screenText?: string;
  visiblePrompts?: string[];
  promptCandidates?: string[];
  agentContext?: string;
  workspaceName?: string;
  signals?: Partial<FrustrationSignals>;
  v_strain?: number;
  vocalStrain?: number;
  f_micro_expressions?: number;
  facialMicroExpressions?: number;
  p_looping?: number;
  promptLooping?: number;
};

export type FrustrationEvaluation = {
  coefficient: number;
  isLocked: boolean;
  reason: string;
  relevantQuery: string;
  agentContext?: string;
  workspaceName?: string;
  signals: FrustrationSignals;
  visiblePrompts: string[];
};
