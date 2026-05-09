/**
 * RAGE_THRESHOLD controls when the circuit-breaker fires.
 *
 * Frustration is now scored by CONTENT analysis (Gemini Flash) — not
 * volume.  0.35 means the developer must show genuine frustration
 * signals (angry words, repeated complaints, tense face) to trigger.
 */
export const RAGE_THRESHOLD = 0.35;

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
  signals: FrustrationSignals;
  visiblePrompts: string[];
};

export function evaluateFrustration(message: DetectorMessage): FrustrationEvaluation {
  const directScore = numberOrNull(message.frustration);
  const vStrain = coalesceSignal(
    message.signals?.vStrain,
    message.v_strain,
    message.vocalStrain,
    directScore
  );
  const fMicroExpressions = coalesceSignal(
    message.signals?.fMicroExpressions,
    message.f_micro_expressions,
    message.facialMicroExpressions,
    directScore
  );
  const pLooping = coalesceSignal(
    message.signals?.pLooping,
    message.p_looping,
    message.promptLooping,
    directScore
  );

  const formulaScore = clamp01(vStrain * 0.4 + fMicroExpressions * 0.4 + pLooping * 0.2);
  const coefficient = directScore === null ? formulaScore : Math.max(formulaScore, directScore);
  const visiblePrompts = normalizePrompts(message.visiblePrompts ?? message.promptCandidates ?? []);

  return {
    coefficient,
    isLocked: message.locked ?? coefficient > RAGE_THRESHOLD,
    reason: message.reason ?? defaultReason(coefficient),
    relevantQuery: message.relevantQuery ?? visiblePrompts.at(-1) ?? message.screenText ?? "",
    signals: {
      vStrain,
      fMicroExpressions,
      pLooping
    },
    visiblePrompts
  };
}

function coalesceSignal(...values: Array<number | null | undefined>) {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return clamp01(value ?? 0);
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : null;
}

function normalizePrompts(prompts: string[]) {
  return prompts
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(-3);
}

function defaultReason(coefficient: number) {
  if (coefficient > RAGE_THRESHOLD) {
    return "Frustration coefficient exceeded the circuit-breaker threshold.";
  }

  return "Signals are below the circuit-breaker threshold.";
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
