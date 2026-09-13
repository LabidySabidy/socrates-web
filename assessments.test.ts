/**
 * assessments.test.ts — T-028: authored items, generated-and-validated items, and the citations a
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTO_GRADE_MAX_CHARS,
  MISTAKE_LIMIT,
  isAutoGradable,
  awardedBadge,
  badgeState,
  buildGenerationPrompt,
  cachePath,
  extractItems,
  raisesBadge,
  readCache,
  validateItem,
  validateItems,
  writeCache,
  type AssessmentItem,
} from "./assessments.ts";

const goodItem = {
  prompt: "A line passes through (0, -2) and (1, 1). What is its slope?",
  answer: "3",
  accepts: ["3.0"],
  hints: ["Count the rise between the two points.", "Divide the rise by the run.", "(1 - (-2)) / (1 - 0)"],
  steps: ["Slope = rise / run", "= (1 - (-2)) / (1 - 0)", "= 3 / 1 = 3"],
};


function tmp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "assess-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// attempt -> mastery mapping (T-043)
// ---------------------------------------------------------------------------

test("the gate's own rule: under two mistakes reaches Proficient, two forfeits it", () => {
  assert.equal(awardedBadge(3, 0), "🟩");
  assert.equal(awardedBadge(3, 1), "🟩", "one mistake still leaves Proficient reachable");
  assert.equal(awardedBadge(2, 2), "🟨", "the gate closes at two");
  assert.equal(awardedBadge(0, 5), "🟨");
});

test("an attempt never awards Mastered — nothing licenses a quiz to top the scale", () => {
  for (const wrong of [0, 1, 2, 9]) {
    assert.notEqual(awardedBadge(10, wrong), "🟦");
  }
});

test("the mapping mirrors the quiz UI's MISTAKE_LIMIT", () => {
  // If the gate fires at a different count than the rule, the completion copy and the gate copy
  // would contradict each other in the same session.
  assert.equal(MISTAKE_LIMIT, 2);
});

test("badges only ever raise", () => {
  assert.equal(raisesBadge("⬜", "🟨"), true);
  assert.equal(raisesBadge("🟨", "🟩"), true);
  assert.equal(raisesBadge("🟩", "🟩"), false, "an equal award is not a raise");
  assert.equal(raisesBadge("🟩", "🟨"), false, "an attempt never lowers a badge");
  assert.equal(raisesBadge("🟦", "🟩"), false, "nor does it demote a mastered concept");
  assert.equal(raisesBadge(undefined, "🟨"), true, "an unmeasured concept can be raised");
  assert.equal(raisesBadge("⬜", "🟦"), true, "the ladder is ordered, not a set");
});

test("badgeState names the five states and nothing else", () => {
  assert.equal(badgeState("🟩"), "Proficient");
  assert.equal(badgeState("🟨"), "Familiar");
  assert.equal(badgeState("⬜"), "Not started");
  assert.equal(badgeState("?"), "Not started", "an unknown badge reads as not started");
});

// ---------------------------------------------------------------------------
// P8 — the grading contract
// ---------------------------------------------------------------------------

test("a short answer may be auto-graded; a long one may not", () => {
  assert.equal(isAutoGradable("3"), true);
  assert.equal(isAutoGradable("select"), true);
  assert.equal(isAutoGradable("status = 'approved'"), true);
  assert.equal(isAutoGradable("DROP POLICY IF EXISTS"), true, "five words is still a checkable term");

  assert.equal(isAutoGradable("The CREATE POLICY statement fails; guard it by dropping it first."), false);
  assert.equal(isAutoGradable("one two three four five six seven"), false, "over the word limit");
  assert.equal(isAutoGradable("x".repeat(AUTO_GRADE_MAX_CHARS + 1)), false, "over the character limit");
  assert.equal(isAutoGradable("First sentence. Second sentence."), false, "two sentences is prose");
  assert.equal(isAutoGradable("   "), false);
});

test("a long answer is REJECTED as short-answer, with an error naming the fix", () => {
  const prose = "The CREATE POLICY statement fails; guard it by dropping it first before recreating it.";
  const r = validateItem({ ...goodItem, answer: prose }, { id: "q" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /answer-too-long-for-auto-grading/);
});

test("the same long answer is accepted once it declares itself a self-check", () => {
  const prose = "The CREATE POLICY statement fails; guard it by dropping it first before recreating it.";
  const r = validateItem(
    { ...goodItem, answer: prose, mode: "self-check" },
    { id: "q" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.item.mode, "self-check");
    assert.equal(r.item.answer, prose, "the model answer is kept: it IS the solution");
  }
});

test("mode defaults to short-answer, and any other value is not a mode", () => {
  const plain = validateItem(
    { ...goodItem, mode: "whatever" },
    { id: "q" },
  );
  assert.equal(plain.ok, true);
  if (plain.ok) assert.equal(plain.item.mode, "short-answer", "an unknown mode falls back to the safe default");
});

test("the generation prompt demands short answers and documents the self-check escape", () => {
  const prompt = buildGenerationPrompt({
    courseTitle: "C",
    unitTitle: "U",
    concepts: ["a"],
    count: 2,
  });
  assert.match(prompt, /MUST be short and checkable/);
  assert.match(prompt, /at most 6 words/);
  assert.match(prompt, /"mode": "self-check"/);
  assert.match(prompt, /would mark correct paraphrases wrong/);
  assert.match(prompt, /"mode": "short-answer"/);
  assert.match(prompt, /"mode": "short-answer", "answer"/, "the JSON example shows the field");
});

// ---------------------------------------------------------------------------
// attempt -> mastery mapping (T-043)
// ---------------------------------------------------------------------------

test("the gate's own rule: under two mistakes reaches Proficient, two forfeits it", () => {
  assert.equal(awardedBadge(3, 0), "🟩");
  assert.equal(awardedBadge(3, 1), "🟩", "one mistake still leaves Proficient reachable");
  assert.equal(awardedBadge(2, 2), "🟨", "the gate closes at two");
  assert.equal(awardedBadge(0, 5), "🟨");
});

test("an attempt never awards Mastered — nothing licenses a quiz to top the scale", () => {
  for (const wrong of [0, 1, 2, 9]) {
    assert.notEqual(awardedBadge(10, wrong), "🟦");
  }
});

test("the mapping mirrors the quiz UI's MISTAKE_LIMIT", () => {
  // If the gate fires at a different count than the rule, the completion copy and the gate copy
  // would contradict each other in the same session.
  assert.equal(MISTAKE_LIMIT, 2);
});

test("badges only ever raise", () => {
  assert.equal(raisesBadge("⬜", "🟨"), true);
  assert.equal(raisesBadge("🟨", "🟩"), true);
  assert.equal(raisesBadge("🟩", "🟩"), false, "an equal award is not a raise");
  assert.equal(raisesBadge("🟩", "🟨"), false, "an attempt never lowers a badge");
  assert.equal(raisesBadge("🟦", "🟩"), false, "nor does it demote a mastered concept");
  assert.equal(raisesBadge(undefined, "🟨"), true, "an unmeasured concept can be raised");
  assert.equal(raisesBadge("⬜", "🟦"), true, "the ladder is ordered, not a set");
});

test("badgeState names the five states and nothing else", () => {
  assert.equal(badgeState("🟩"), "Proficient");
  assert.equal(badgeState("🟨"), "Familiar");
  assert.equal(badgeState("⬜"), "Not started");
  assert.equal(badgeState("?"), "Not started", "an unknown badge reads as not started");
});

// ---------------------------------------------------------------------------
// P8 — the grading contract
// ---------------------------------------------------------------------------

test("a short answer may be auto-graded; a long one may not", () => {
  assert.equal(isAutoGradable("3"), true);
  assert.equal(isAutoGradable("select"), true);
  assert.equal(isAutoGradable("status = 'approved'"), true);
  assert.equal(isAutoGradable("DROP POLICY IF EXISTS"), true, "five words is still a checkable term");

  assert.equal(isAutoGradable("The CREATE POLICY statement fails; guard it by dropping it first."), false);
  assert.equal(isAutoGradable("one two three four five six seven"), false, "over the word limit");
  assert.equal(isAutoGradable("x".repeat(AUTO_GRADE_MAX_CHARS + 1)), false, "over the character limit");
  assert.equal(isAutoGradable("First sentence. Second sentence."), false, "two sentences is prose");
  assert.equal(isAutoGradable("   "), false);
});

test("a long answer is REJECTED as short-answer, with an error naming the fix", () => {
  const prose = "The CREATE POLICY statement fails; guard it by dropping it first before recreating it.";
  const r = validateItem({ ...goodItem, answer: prose }, { id: "q" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /answer-too-long-for-auto-grading/);
});

test("the same long answer is accepted once it declares itself a self-check", () => {
  const prose = "The CREATE POLICY statement fails; guard it by dropping it first before recreating it.";
  const r = validateItem(
    { ...goodItem, answer: prose, mode: "self-check" },
    { id: "q" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.item.mode, "self-check");
    assert.equal(r.item.answer, prose, "the model answer is kept: it IS the solution");
  }
});

test("mode defaults to short-answer, and any other value is not a mode", () => {
  const plain = validateItem(
    { ...goodItem, mode: "whatever" },
    { id: "q" },
  );
  assert.equal(plain.ok, true);
  if (plain.ok) assert.equal(plain.item.mode, "short-answer", "an unknown mode falls back to the safe default");
});

test("the generation prompt demands short answers and documents the self-check escape", () => {
  const prompt = buildGenerationPrompt({
    courseTitle: "C",
    unitTitle: "U",
    concepts: ["a"],
    count: 2,
  });
  assert.match(prompt, /MUST be short and checkable/);
  assert.match(prompt, /at most 6 words/);
  assert.match(prompt, /"mode": "self-check"/);
  assert.match(prompt, /would mark correct paraphrases wrong/);
  assert.match(prompt, /"mode": "short-answer"/);
  assert.match(prompt, /"mode": "short-answer", "answer"/, "the JSON example shows the field");
});

// ---------------------------------------------------------------------------
// citations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validation — the gate
// ---------------------------------------------------------------------------

test("a well-formed item passes and is normalised", () => {
  const r = validateItem(goodItem, { id: "q1" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.item.id, "q1");
  assert.equal(r.item.answer, "3");
  assert.equal(r.item.hints.length, 3);
  assert.equal(r.item.steps.length, 3);
});

test("every missing field is its own clear error", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...goodItem, prompt: "  " }, /missing-prompt/],
    [{ ...goodItem, answer: "" }, /missing-answer/],
    [{ ...goodItem, hints: [] }, /missing-hints/],
    [{ ...goodItem, steps: [] }, /missing-steps/],
    ["not an object", /not an object/],
  ];
  for (const [raw, expected] of cases) {
    const r = validateItem(raw, { id: "q" });
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.match(r.error, expected);
  }
});

test("validateItems reports per-item errors and keeps the good ones", () => {
  const { items, errors } = validateItems(
    [goodItem, { prompt: "", answer: "1" }, { ...goodItem, hints: [] }],
    { prefix: "slope-q" },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "slope-q1");
  assert.deepEqual(errors, ["slope-q2: item-missing-prompt", "slope-q3: item-missing-hints"]);
});

// ---------------------------------------------------------------------------
// extraction from a model reply — the FAILURE path matters most
// ---------------------------------------------------------------------------

test("items are extracted from a fenced json block or a tagged block", () => {
  const fenced = 'Sure!\n```json\n{"items":[{"prompt":"p","answer":"a","hints":["h"],"steps":["s"]}]}\n```\n';
  const a = extractItems(fenced);
  assert.ok(Array.isArray(a.raw) && a.raw.length === 1);

  const tagged = '<assessments>[{"prompt":"p","answer":"a","hints":["h"],"steps":["s"]}]</assessments>';
  const b = extractItems(tagged);
  assert.ok(Array.isArray(b.raw) && b.raw.length === 1);

  // A bare top-level array is deliberately NOT accepted: a stray '[' in prose must never be
  // mistaken for the payload. The fence or the tag is the contract.
  const bare = extractItems('[{"prompt":"p"}]');
  assert.equal(bare.raw, undefined);
  assert.match(bare.error!, /no JSON block/);
});

test("every extraction failure says what was wrong", () => {
  assert.match(extractItems("no block here at all")!.error!, /no JSON block/);
  assert.match(extractItems("```json\n{not json}\n```")!.error!, /did not parse/);
  assert.match(extractItems('```json\n{"items":"nope"}\n```')!.error!, /no items array/);
  assert.match(extractItems('```json\n{"other":1}\n```')!.error!, /no items array/);
});

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

test("the cache round-trips and a corrupt file reads as absent", (t) => {
  const dir = tmp(t);
  const items = [goodItem] as unknown as AssessmentItem[];
  assert.equal(readCache(dir, 1), null, "nothing cached yet");

  writeCache(dir, 1, items, "2026-09-13T00:00:00.000Z");
  const read = readCache(dir, 1);
  assert.equal(read?.items.length, 1);
  assert.equal(read?.generatedAt, "2026-09-13T00:00:00.000Z");
  assert.equal(cachePath(dir, 1).endsWith(join("ASSESSMENTS", "unit-1.json")), true);

  writeFileSync(cachePath(dir, 2), "{ broken");
  assert.equal(readCache(dir, 2), null, "a corrupt cache is treated as missing, never half-served");
});
