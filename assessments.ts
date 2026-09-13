/**
 * assessments.ts — quiz items: authored when present, generated and VALIDATED otherwise.
 *
 * This module VALIDATES an item; it does not grade one. Answer checking lives with the quiz UI
 * (web/src/assessment-types.ts) because nothing on the server scores a submission, and a second
 * implementation of the correctness rule would be free to disagree with the first.
 *
 * The honesty rule for this feature is that an item is never served unless it validates. A
 * generated item that fails validation produces an error the UI can show, never a half-rendered
 * question — a quiz with a missing answer is worse than no quiz.
 *
 * For a `codebase` course an item must cite a real artifact from the repository, and the citation
 * is checked against the filesystem before the item is accepted.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * How an item is graded.
 *
 * `short-answer` is auto-graded, which is only safe for an answer a learner can be expected to
 * reproduce exactly: a value, a term, a number, an identifier. Anything longer cannot be checked
 * against a list of accepted phrasings, and a paraphrase would be marked WRONG — a false negative,
 * which is worse than a false positive in a learning tool because it punishes a correct answer.
 *
 * `self-check` reveals the worked solution and lets the learner judge their own prose. It is never
 * auto-marked.
 */
export type GradingMode = "short-answer" | "self-check";

/** Limits for an auto-graded answer. Above either one, the item must be a self-check. */
export const AUTO_GRADE_MAX_WORDS = 6;
export const AUTO_GRADE_MAX_CHARS = 60;

/** True when an answer is short enough that exact-ish comparison is fair. */
export function isAutoGradable(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) return false;
  if (trimmed.length > AUTO_GRADE_MAX_CHARS) return false;
  if (trimmed.split(/\s+/).filter(Boolean).length > AUTO_GRADE_MAX_WORDS) return false;
  // More than one sentence is prose, however short.
  return !/[.!?]\s+\S/.test(trimmed);
}

export interface AssessmentItem {
  id: string;
  prompt: string;
  answer: string;
  mode: GradingMode;
  /** Alternative accepted answers, e.g. an equivalent spelling or unit. */
  accepts: string[];
  hints: string[];
  steps: string[];
  /** Repo-relative citations. Required for a `codebase` course. */
  cites: string[];
}

export interface Quiz {
  id: string;
  title: string;
  unit: number;
  items: AssessmentItem[];
  source: "authored" | "generated" | "cache";
}

export interface CiteOracle {
  exists(rel: string): boolean;
  lineCount(rel: string): number | null;
}

export const WARN = {
  answerTooLong: (words: number, chars: number) =>
    `answer-too-long-for-auto-grading:${words}-words-${chars}-chars-use-self-check`,
  needsCite: "item-missing-citation",
  badCite: (c: string) => `citation-not-found:${c}`,
  badLine: (c: string, n: number) => `citation-line-out-of-range:${c}#L${n}`,
  noPrompt: "item-missing-prompt",
  noAnswer: "item-missing-answer",
  noHints: "item-missing-hints",
  noSteps: "item-missing-steps",
} as const;

export type ValidateResult = { ok: true; item: AssessmentItem } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// The attempt -> mastery mapping
// ---------------------------------------------------------------------------

/**
 * Mistakes in one attempt before the design's mastery gate closes.
 * Mirrors `MISTAKE_LIMIT` in web/src/quiz.ts — the gate and this rule must agree.
 */
export const MISTAKE_LIMIT = 2;

/** The badge ladder, worst to best. Raising only ever moves right. */
const LADDER = ["⬜", "🟥", "🟨", "🟩", "🟦"] as const;

/**
 * What a completed attempt QUALIFIES the concept for.
 *
 * This rule is not invented. The only statement of a quiz-to-mastery relationship anywhere in this
 * project is the design's mastery-gate copy: "You can no longer reach 'Proficient' on this attempt.
 * You can keep going or start over. Start over is available after two mistakes."
 *
 * That says exactly two things, and this function says only those two:
 *   - fewer than two mistakes leaves Proficient reachable for the attempt;
 *   - two or more forfeits Proficient for that attempt, so the attempt tops out at Familiar.
 *
 * It deliberately says nothing about Mastered. A quiz is weaker evidence than a tutor's judgement,
 * and nothing in the project licenses an attempt to award the top of the scale.
 */
export function awardedBadge(right: number, wrong: number): "🟩" | "🟨" {
  void right;
  return wrong < MISTAKE_LIMIT ? "🟩" : "🟨";
}

export function badgeState(badge: string): string {
  return (
    { "⬜": "Not started", "🟥": "Attempted", "🟨": "Familiar", "🟩": "Proficient", "🟦": "Mastered" }[badge] ??
    "Not started"
  );
}

/** True only when the award moves the concept UP. An attempt never lowers a badge. */
export function raisesBadge(current: string | undefined, awarded: string): boolean {
  const from = LADDER.indexOf((current ?? "⬜") as (typeof LADDER)[number]);
  const to = LADDER.indexOf(awarded as (typeof LADDER)[number]);
  return from !== -1 && to !== -1 && to > from;
}

// ---------------------------------------------------------------------------
// Citation checking
// ---------------------------------------------------------------------------

/** `src/a.sql#L12` -> `{ path: "src/a.sql", line: 12 }`. */
export function parseCite(cite: string): { path: string; line: number | null } {
  const m = /^(.*?)#L(\d+)$/.exec(cite.trim());
  if (!m) return { path: cite.trim(), line: null };
  return { path: m[1], line: Number(m[2]) };
}

export function checkCite(cite: string, oracle: CiteOracle): string | null {
  const { path, line } = parseCite(cite);
  if (!path) return WARN.badCite(cite);
  if (!oracle.exists(path)) return WARN.badCite(cite);
  if (line !== null) {
    const count = oracle.lineCount(path);
    if (count === null || line < 1 || line > count) return WARN.badLine(path, line);
  }
  return null;
}

/** A filesystem oracle rooted at a course directory. */
export function courseOracle(courseDir: string): CiteOracle {
  const resolve = (rel: string) => join(courseDir, rel.replace(/^[/\\]+/, ""));
  return {
    exists(rel) {
      try {
        return statSync(resolve(rel)).isFile();
      } catch {
        return false;
      }
    },
    lineCount(rel) {
      try {
        return readFileSync(resolve(rel), "utf8").split("\n").length;
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Validation — the gate every item must pass
// ---------------------------------------------------------------------------

export function validateItem(
  raw: unknown,
  ctx: { id: string; kind: "topic" | "codebase"; oracle: CiteOracle },
): ValidateResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "item is not an object" };
  const r = raw as Record<string, unknown>;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];

  const prompt = str(r.prompt);
  const answer = str(r.answer);
  const hints = list(r.hints);
  const steps = list(r.steps);
  const cites = list(r.cites);
  const accepts = list(r.accepts);

  if (!prompt) return { ok: false, error: WARN.noPrompt };
  if (!answer) return { ok: false, error: WARN.noAnswer };
  if (hints.length === 0) return { ok: false, error: WARN.noHints };
  if (steps.length === 0) return { ok: false, error: WARN.noSteps };

  // Grading mode. Default is auto-graded, but ONLY short answers may claim it: a long answer
  // auto-graded against a list of phrasings marks correct paraphrases wrong.
  const mode: GradingMode = r.mode === "self-check" ? "self-check" : "short-answer";
  if (mode === "short-answer" && !isAutoGradable(answer)) {
    return {
      ok: false,
      error: WARN.answerTooLong(
        answer.split(/\s+/).filter(Boolean).length,
        answer.length,
      ),
    };
  }

  // Citations are validated on both course kinds, but only required for a codebase course.
  const citeProblems = cites.map((c) => checkCite(c, ctx.oracle)).filter((e): e is string => e !== null);
  if (citeProblems.length > 0) return { ok: false, error: citeProblems[0] };
  if (ctx.kind === "codebase" && cites.length === 0) return { ok: false, error: WARN.needsCite };

  return {
    ok: true,
    item: { id: ctx.id, prompt, answer, mode, accepts, hints, steps, cites },
  };
}

export function validateItems(
  raw: unknown,
  ctx: { kind: "topic" | "codebase"; oracle: CiteOracle; prefix?: string },
): { items: AssessmentItem[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const items: AssessmentItem[] = [];
  const errors: string[] = [];
  list.forEach((entry, i) => {
    const id = `${ctx.prefix ?? "q"}${i + 1}`;
    const result = validateItem(entry, { id, kind: ctx.kind, oracle: ctx.oracle });
    if (result.ok) items.push(result.item);
    else errors.push(`${id}: ${result.error}`);
  });
  return { items, errors };
}

// ---------------------------------------------------------------------------
// Extraction — pulling items out of a streamed model reply
// ---------------------------------------------------------------------------

/**
 * Take the first JSON payload out of a model reply.
 *
 * Accepts a fenced ```json block (preferred) or a `<assessments>` block. Returns an error string
 * rather than null so the caller can say WHY generation failed.
 */
export function extractItems(text: string): { raw?: unknown; error?: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const tagged = /<assessments>([\s\S]*?)<\/assessments>/i.exec(text);
  const body = tagged?.[1] ?? fenced?.[1];
  if (!body) return { error: "reply contained no JSON block (expected ```json or <assessments>)" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch (err) {
    return { error: `reply JSON did not parse: ${err instanceof Error ? err.message : String(err)}` };
  }

  const container = parsed as { items?: unknown } | unknown[] | null;
  if (Array.isArray(container)) return { raw: container };
  if (container && typeof container === "object" && Array.isArray((container as { items?: unknown }).items)) {
    return { raw: (container as { items: unknown[] }).items };
  }
  return { error: "reply JSON had no items array" };
}

/** The prompt handed to the tutor. Demands strict JSON so validation has something to check. */
export function buildGenerationPrompt(input: {
  courseTitle: string;
  unitTitle: string;
  kind: "topic" | "codebase";
  concepts: string[];
  count: number;
  existingPrompts?: string[];
}): string {
  const citeRule =
    input.kind === "codebase"
      ? `\n- Every item MUST include a "cites" array naming real files in this repository, as paths relative to the repository root, optionally with a line anchor (for example "src/db/migrations/003.sql#L12"). Read the files before citing them; a citation that does not exist fails validation and the item is rejected.`
      : `\n- "cites" is optional. If you include one it must name a real file in this repository.`;

  return [
    `Produce ${input.count} assessment items for a quiz.`,
    ``,
    `Course: ${input.courseTitle}`,
    `Unit: ${input.unitTitle}`,
    `Concepts in scope: ${input.concepts.join(", ") || "(none recorded)"}`,
    input.existingPrompts?.length
      ? `Do not reuse these prompts: ${input.existingPrompts.join(" | ")}`
      : ``,
    ``,
    `Reply with ONE fenced json block and nothing else:`,
    "```json",
    `{ "items": [ { "prompt": "...", "mode": "short-answer", "answer": "...", "accepts": ["..."], "hints": ["...", "...", "..."], "steps": ["...", "...", "..."], "cites": ["..."] } ] }`,
    "```",
    ``,
    `Rules:`,
    `- "prompt" asks exactly one question and is self-contained.`,
    `- "answer" MUST be short and checkable: a value, a term, a number, or an identifier, at most 6 words. Put spelling and formatting variants in "accepts" — not paraphrases.`,
    `- If the concept genuinely needs a prose answer, set "mode": "self-check" and put the model answer in "answer". Those items are NOT auto-graded: the learner compares against your solution and judges their own work. A long answer WITHOUT "mode": "self-check" is rejected, because auto-grading it would mark correct paraphrases wrong.`,
    `- Otherwise set "mode": "short-answer" (the default).`,
    `- "hints" must be progressive: 3 short hints that narrow the answer without giving it away.`,
    `- "steps" is the full worked solution, in order.`,
    `- Do NOT include the answer inside "hints".`,
    citeRule,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export function assessmentsDir(courseDir: string): string {
  return join(courseDir, ".agent", "learning", "ASSESSMENTS");
}

export function cachePath(courseDir: string, unit: number): string {
  return join(assessmentsDir(courseDir), `unit-${unit}.json`);
}

export function readCache(
  courseDir: string,
  unit: number,
): { items: AssessmentItem[]; generatedAt: string } | null {
  const path = cachePath(courseDir, unit);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      items?: unknown;
      generatedAt?: unknown;
    };
    if (!Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items as AssessmentItem[],
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeCache(
  courseDir: string,
  unit: number,
  items: AssessmentItem[],
  generatedAt: string,
): void {
  const dir = assessmentsDir(courseDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    cachePath(courseDir, unit),
    JSON.stringify({ version: 1, unit, generatedAt, items }, null, 2) + "\n",
    "utf8",
  );
}

export { dirname };
