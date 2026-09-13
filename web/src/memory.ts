/**
 * memory.ts — "Memory strength (SM-2 estimate)".
 *
 * Labelled as an ESTIMATE everywhere it appears. It is never called durable retention: nothing on
 * disk measures retention. The inputs are the real SM-2 fields and the formula is monotone in each
 * of them, so the number can always be audited against the SM-2 panel rendered beside it.
 *
 *   strength = 0.50 * min(repetitions, 5)/5
 *            + 0.30 * min(interval, 30)/30
 *            + 0.20 * clamp((ease_factor - 1.3) / (2.5 - 1.3), 0, 1)
 *
 * With no reviews at all there is nothing to estimate, so it reports "insufficient data" rather
 * than 0%.
 */
import type { LearningData } from "./types.ts";

export interface MemoryStrength {
  /** 0..1, or null when there is insufficient data. */
  value: number | null;
  reviewed: number;
  total: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function conceptStrength(sm2: {
  repetitions: number | null;
  interval: number | null;
  ease_factor: number | null;
}): number {
  const repetitions = sm2.repetitions ?? 0;
  const interval = sm2.interval ?? 0;
  const ease = sm2.ease_factor ?? 2.5;
  return (
    0.5 * (Math.min(repetitions, 5) / 5) +
    0.3 * (Math.min(Math.max(interval, 0), 30) / 30) +
    0.2 * clamp01((ease - 1.3) / (2.5 - 1.3))
  );
}

export function memoryStrength(learning: LearningData | null): MemoryStrength {
  const concepts = learning?.schema.concepts ?? [];
  const reviewed = concepts.filter((c) => (c.sm2.repetitions ?? 0) > 0 || (c.sm2.interval ?? 0) > 0);
  if (concepts.length === 0 || reviewed.length === 0) {
    return { value: null, reviewed: reviewed.length, total: concepts.length };
  }
  const mean = reviewed.reduce((sum, c) => sum + conceptStrength(c.sm2), 0) / reviewed.length;
  return { value: clamp01(mean), reviewed: reviewed.length, total: concepts.length };
}
