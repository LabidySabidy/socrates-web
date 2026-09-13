/**
 * assessment-types.ts — the client's view of a quiz item, and the answer-checking rule.
 *
 * The client OWNS scoring: nothing on the server grades a submission, so this is the only
 * implementation of "is this answer right". The server validates items before serving them; it
 * deliberately does not carry a second copy of this rule, because two implementations of
 * correctness are free to disagree and the one the learner sees would be the wrong one.
 */

export interface AssessmentItem {
  id: string;
  prompt: string;
  answer: string;
  accepts: string[];
  hints: string[];
  steps: string[];
  cites: string[];
}

export interface AssessmentsResponse {
  unit: number;
  source: "authored" | "generated" | "cache" | "none";
  items: AssessmentItem[];
  generatedAt?: string;
  rejected?: string[];
  warnings: string[];
  /** Present on a failure response, so the UI can show an error rather than half a quiz. */
  error?: string;
  detail?: string;
  excerpt?: string;
}

function normaliseAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .replace(/^\+/, "");
}

function asNumber(value: string): number | null {
  const cleaned = normaliseAnswer(value).replace(/,/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Numeric answers compare numerically, so "3" accepts "3.0" and " 3 " — what a learner typing into
 * a box actually produces. Everything else compares on normalised text.
 */
export function isCorrect(item: Pick<AssessmentItem, "answer" | "accepts">, given: string): boolean {
  const candidates = [item.answer, ...(item.accepts ?? [])];
  const givenNum = asNumber(given);
  for (const candidate of candidates) {
    if (normaliseAnswer(candidate) === normaliseAnswer(given)) return true;
    const candidateNum = asNumber(candidate);
    if (givenNum !== null && candidateNum !== null && givenNum === candidateNum) return true;
  }
  return false;
}
