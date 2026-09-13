/**
 * assessments.test.ts — T-028: authored items, generated-and-validated items, and the citations a
 * `codebase` course requires.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MISTAKE_LIMIT,
  awardedBadge,
  badgeState,
  buildGenerationPrompt,
  cachePath,
  checkCite,
  courseOracle,
  extractItems,
  parseCite,
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

const noOracle = { exists: () => false, lineCount: () => null };
const yesOracle = { exists: () => true, lineCount: () => 100 };

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
// citations
// ---------------------------------------------------------------------------

test("parseCite splits a line anchor off a path", () => {
  assert.deepEqual(parseCite("src/a.sql#L12"), { path: "src/a.sql", line: 12 });
  assert.deepEqual(parseCite("src/a.sql"), { path: "src/a.sql", line: null });
});

test("a citation must name a real file, and a line anchor must be in range", (t) => {
  const dir = tmp(t);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "policy.sql"), "line one\nline two\nline three\n");
  const oracle = courseOracle(dir);

  assert.equal(checkCite("src/policy.sql", oracle), null);
  assert.equal(checkCite("src/policy.sql#L2", oracle), null);
  assert.match(checkCite("src/policy.sql#L99", oracle)!, /line-out-of-range/);
  assert.match(checkCite("src/nope.sql", oracle)!, /not-found/);
  assert.match(checkCite("../../etc/passwd", oracle)!, /not-found/, "traversal resolves nowhere");
  assert.equal(oracle.lineCount("src/policy.sql"), 4, "three lines plus the trailing newline");
});

// ---------------------------------------------------------------------------
// validation — the gate
// ---------------------------------------------------------------------------

test("a well-formed item passes and is normalised", () => {
  const r = validateItem(goodItem, { id: "q1", kind: "topic", oracle: noOracle });
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
    const r = validateItem(raw, { id: "q", kind: "topic", oracle: noOracle });
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.match(r.error, expected);
  }
});

test("a codebase course REQUIRES a citation that resolves", () => {
  const missing = validateItem(goodItem, { id: "q", kind: "codebase", oracle: yesOracle });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /missing-citation/);

  const dangling = validateItem(
    { ...goodItem, cites: ["src/ghost.sql"] },
    { id: "q", kind: "codebase", oracle: noOracle },
  );
  assert.equal(dangling.ok, false);
  if (!dangling.ok) assert.match(dangling.error, /citation-not-found/);

  const ok = validateItem(
    { ...goodItem, cites: ["src/real.sql#L3"] },
    { id: "q", kind: "codebase", oracle: yesOracle },
  );
  assert.equal(ok.ok, true, "a real citation satisfies the requirement");
});

test("a topic course allows an absent citation but still validates one that is present", () => {
  assert.equal(validateItem(goodItem, { id: "q", kind: "topic", oracle: noOracle }).ok, true);
  const bad = validateItem({ ...goodItem, cites: ["nope.sql"] }, { id: "q", kind: "topic", oracle: noOracle });
  assert.equal(bad.ok, false, "an optional citation is still checked when given");
});

test("validateItems reports per-item errors and keeps the good ones", () => {
  const { items, errors } = validateItems(
    [goodItem, { prompt: "", answer: "1" }, { ...goodItem, hints: [] }],
    { kind: "topic", oracle: noOracle, prefix: "slope-q" },
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

test("the generation prompt demands the citation for a codebase course and not for a topic", () => {
  const base = { courseTitle: "C", unitTitle: "U", concepts: ["a"], count: 3 };
  const code = buildGenerationPrompt({ ...base, kind: "codebase" });
  const topic = buildGenerationPrompt({ ...base, kind: "topic" });
  assert.match(code, /MUST include a "cites" array/);
  assert.match(code, /relative to the repository root/);
  assert.match(code, /fails validation and the item is rejected/);
  assert.match(topic, /"cites" is optional/);
  assert.match(topic, /3 assessment items/);
  assert.match(buildGenerationPrompt({ ...base, kind: "topic", existingPrompts: ["old one"] }), /Do not reuse these prompts: old one/);
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
