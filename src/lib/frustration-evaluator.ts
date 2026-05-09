import type { DetectorMessage, FrustrationEvaluation } from "./types";

/**
 * Frustration is scored by CONTENT analysis (Gemini Flash) — not volume.
 * 0.35 means the developer must show genuine frustration signals
 * (angry words, repeated complaints, tense face) to trigger.
 */
export const RAGE_THRESHOLD = 0.35;

/** EWMA smoothing factor — higher = more weight on latest sample. */
const EWMA_ALPHA = 0.45;

let previousCoefficient = 0;

export function evaluateFrustration(message: DetectorMessage): FrustrationEvaluation {
  const directScore = numberOrNull(message.frustration);
  const vStrain = coalesceSignal(message.signals?.vStrain, message.v_strain, message.vocalStrain, directScore);
  const fMicro = coalesceSignal(message.signals?.fMicroExpressions, message.f_micro_expressions, message.facialMicroExpressions, directScore);
  const pLoop = coalesceSignal(message.signals?.pLooping, message.p_looping, message.promptLooping, directScore);

  const raw = clamp01(vStrain * 0.4 + fMicro * 0.4 + pLoop * 0.2);
  const instant = directScore === null ? raw : Math.max(raw, directScore);

  // EWMA: frustration carries momentum — a single calm tick won't zero it out
  const coefficient = clamp01(EWMA_ALPHA * instant + (1 - EWMA_ALPHA) * previousCoefficient);
  previousCoefficient = coefficient;

  const visiblePrompts = normalizePrompts(message.visiblePrompts ?? message.promptCandidates ?? []);

  return {
    coefficient,
    isLocked: message.locked ?? coefficient > RAGE_THRESHOLD,
    reason: message.reason ?? defaultReason(coefficient),
    relevantQuery: message.relevantQuery ?? visiblePrompts.at(-1) ?? message.screenText ?? "",
    agentContext: message.agentContext,
    workspaceName: message.workspaceName,
    signals: { vStrain, fMicroExpressions: fMicro, pLooping: pLoop },
    visiblePrompts,
  };
}

/** Reset EWMA state (e.g. when monitoring stops). */
export function resetFrustrationState() {
  previousCoefficient = 0;
}

function coalesceSignal(...values: (number | null | undefined)[]) {
  const v = values.find((c) => typeof c === "number" && Number.isFinite(c));
  return clamp01(v ?? 0);
}

function numberOrNull(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? clamp01(v) : null;
}

function normalizePrompts(prompts: string[]) {
  return prompts.map((p) => p.trim()).filter(Boolean).slice(-3);
}

function defaultReason(c: number) {
  return c > RAGE_THRESHOLD
    ? "Frustration coefficient exceeded the circuit-breaker threshold."
    : "Signals are below the circuit-breaker threshold.";
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
