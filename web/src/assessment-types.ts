/**
 * assessment-types.ts — the client's view of a quiz item, and the answer-checking rule.
 *
 * The client OWNS scoring: nothing on the server grades a submission, so this is the only
 * implementation of "is this answer right". The server validates items before serving them; it
 * deliberately does not carry a second copy of this rule, because two implementations of
 * correctness are free to disagree and the one the learner sees would be the wrong one.
 */

/**
 * How an item is graded. The server only sends `short-answer` when the answer is short enough that
 * exact-ish comparison is FAIR — auto-grading prose marks correct paraphrases wrong, and a false
 * negative punishes a learner who was right.
 */
export type GradingMode = "short-answer" | "self-check";

export interface AssessmentItem {
  id: string;
  prompt: string;
  answer: string;
  mode: GradingMode;
  accepts: string[];
  hints: string[];
  steps: string[];
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

/**
 * Fold away everything that is presentation rather than content: unicode form, curly quotes and
 * dashes, case, whitespace, surrounding quotes/brackets, and trailing sentence punctuation.
 *
 * Internal punctuation is KEPT. `status = 'approved'` and `status approved` are not the same answer,
 * and a normaliser that thought they were would start accepting wrong answers to fix false
 * negatives — trading one error for a worse one.
 */
export function normaliseAnswer(value: string): string {
  const folded = value
    .normalize("NFKC")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  // Trailing sentence punctuation first, so `approved'.` and `approved'` agree.
  const withoutTail = folded.replace(/[.;,]+$/, "");

  // Then unwrap ONLY a matching pair. Stripping any trailing quote would eat the closing quote of a
  // quoted VALUE — `status = 'approved'` would lose it and stop matching itself.
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["(", ")"],
    ["[", "]"],
  ];
  for (const [open, close] of pairs) {
    if (withoutTail.length > 1 && withoutTail.startsWith(open) && withoutTail.endsWith(close)) {
      return withoutTail.slice(1, -1).trim().replace(/^\+/, "");
    }
  }
  return withoutTail.replace(/^\+/, "");
}

/** An item is auto-graded only when the server says it may be. */
export function gradingMode(item: { mode?: GradingMode }): GradingMode {
  return item.mode === "self-check" ? "self-check" : "short-answer";
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
export function isCorrect(
  // `mode` is optional so a caller that only has an answer can still ask; an absent mode is
  // treated as short-answer, which is the server's own default.
  item: Pick<AssessmentItem, "answer" | "accepts"> & { mode?: GradingMode },
  given: string,
): boolean {
  // A self-check item has no correct answer to compute: the learner judges it.
  if (gradingMode(item) === "self-check") return false;
  const candidates = [item.answer, ...(item.accepts ?? [])];
  const givenNum = asNumber(given);
  for (const candidate of candidates) {
    if (normaliseAnswer(candidate) === normaliseAnswer(given)) return true;
    const candidateNum = asNumber(candidate);
    if (givenNum !== null && candidateNum !== null && givenNum === candidateNum) return true;
  }
  return false;
}
