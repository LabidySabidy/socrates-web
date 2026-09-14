/**
 * ui.test.ts — client-side logic that must not drift, tested without a browser.
 *
 * The server sends the STATE (severity, mastery); the client owns the COLOURS. These tests guard
 * the presentation mapping and the pure list logic, so a change is caught here rather than by
 * eyeballing a screenshot.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { activeCount, trayRows } from "./misconceptions.ts";
import { SEVERITY_COLOR, SEVERITY_LABEL, MASTERY_STATES, mastery } from "./severity.ts";
import { memoryStrength } from "./memory.ts";
import {
  catalogueCourses,
  filterCourses,
  mostRecent,
  totalMasteryCounts,
} from "./select.ts";
import { ALL_MODULE_TYPES, MODULE_LABELS, MODULE_PATHS, moduleTypeLabel } from "./module-types.ts";
import { emptyTurn, isSilent, reduceTurn, splitTurn, streamErrorText } from "./turn.ts";
import { gradingMode, isCorrect, type AssessmentItem } from "./assessment-types.ts";
import { completionView } from "./completion.ts";
import { compile, sample } from "./expr.ts";
import { parseWatchFrame } from "./watch.ts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { humanize } from "./humanize.ts";
import { moduleRingLabel } from "./module-types.ts";
import { courseErrorView, shouldFollowRename } from "./course-error.ts";
import { moduleAskHref } from "./grill.ts";
import { sessionMisconceptionLine, stripAbsolutePaths } from "./session-note.ts";
import { accuracy, bandFraction, CLEAR_AFTER_SECONDS, initGame, launch, markerAt, tick } from "./game.ts";
import {
  actionLabel,
  canSkip,
  check,
  dismissGate,
  initQuiz,
  judge,
  next as nextItem,
  restart,
  reveal,
  score,
  setAnswer,
  showHint,
  tryAgain,
} from "./quiz.ts";
import { courseScrollKey, readPaneScroll, savePaneScroll } from "./scroll.ts";
import {
  grillHref,
  grillPrompt,
  isGrillPrompt,
  parseAsk,
  scaffoldHref,
  scaffoldPrompt,
  SCAFFOLD_SKILL,
} from "./grill.ts";
import { appendUser, isTranscriptEmpty, settleAssistant, type ChatTurn } from "./transcript.ts";
import {
  isPassiveText,
  isPassivitySignal,
  maySubmit,
  refusalReason,
} from "./passivity.ts";
import {
  findGateToken,
  formatCountdown,
  isFrozen,
  REST_SECONDS,
  splitAtGate,
} from "./restgate.ts";
import { parseHash } from "./router.ts";
import type { CourseRef, LearningData, Misconception } from "./types.ts";

const mis = (over: Partial<Misconception>): Misconception =>
  ({
    id: "MIS-001",
    concept: "c",
    misconception: "believed x",
    corrected: "",
    status: "open",
    date: "2026-09-01",
    severity: "",
    severityState: "unrated",
    ...over,
  }) as Misconception;

// ---------------------------------------------------------------------------
// tray — one row per id, always
// ---------------------------------------------------------------------------

test("three registry rows for one id collapse to a single tray row", () => {
  const rows = trayRows([
    mis({ id: "MIS-003", misconception: "short" }),
    mis({ id: "MIS-003", misconception: "a much longer description of the same belief" }),
    mis({ id: "MIS-003", misconception: "medium length" }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowCount, 3, "the collapse is recorded for diagnostics");
  assert.equal(rows[0].misconception, "a much longer description of the same belief");
});

test("the winning row prefers resolved, then a filled correction, then the longer text", () => {
  const resolved = trayRows([
    mis({ id: "MIS-004", status: "open", severityState: "root" }),
    mis({ id: "MIS-004", status: "resolved", corrected: "the right model" }),
  ]);
  assert.equal(resolved[0].status, "resolved");
  assert.equal(resolved[0].corrected, "the right model");
  assert.equal(resolved[0].severity, "resolved", "resolution outranks a stale rating");

  const corrected = trayRows([
    mis({ id: "MIS-005", misconception: "longer but uncorrected text here" }),
    mis({ id: "MIS-005", misconception: "short", corrected: "own words" }),
  ]);
  assert.equal(corrected[0].corrected, "own words");
});

test("rows sort by severity: root, partial, edge, unrated, then resolved", () => {
  const rows = trayRows([
    mis({ id: "MIS-4", status: "resolved", corrected: "done" }),
    mis({ id: "MIS-2", severityState: "partial", severity: "partial" }),
    mis({ id: "MIS-1", severityState: "root", severity: "root" }),
    mis({ id: "MIS-3", severityState: "unrated" }),
    mis({ id: "MIS-5", severityState: "edge", severity: "edge" }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.severity),
    ["root", "partial", "edge", "unrated", "resolved"],
  );
});

test("activeCount excludes resolved rows only", () => {
  const rows = trayRows([
    mis({ id: "MIS-1" }),
    mis({ id: "MIS-2", status: "resolved", corrected: "c" }),
    mis({ id: "MIS-3" }),
  ]);
  assert.equal(rows.length, 3);
  assert.equal(activeCount(rows), 2);
  assert.equal(activeCount([]), 0);
});

// ---------------------------------------------------------------------------
// presentation scales
// ---------------------------------------------------------------------------

test("every severity state has a label and a colour, and only unrated is neutral", () => {
  const states = ["root", "partial", "edge", "resolved", "unrated"] as const;
  assert.deepEqual(Object.keys(SEVERITY_LABEL).sort(), [...states].sort());
  assert.deepEqual(Object.keys(SEVERITY_COLOR).sort(), [...states].sort());
  assert.equal(SEVERITY_COLOR.root, "#c83f3f");
  assert.equal(SEVERITY_COLOR.partial, "#d97706");
  assert.equal(SEVERITY_COLOR.edge, "#d4a72c");
  assert.equal(SEVERITY_COLOR.resolved, "#c9c6bd");
  assert.match(SEVERITY_COLOR.unrated, /^rgba/, "unrated uses the neutral ink, not a hue");

  // severity and mastery are separate scales and must not share a hue by accident
  assert.notEqual(SEVERITY_COLOR.root, mastery("Attempted").color);
});

test("there are exactly five mastery states, and an unknown one reads Not started", () => {
  assert.equal(MASTERY_STATES.length, 5);
  assert.deepEqual(
    MASTERY_STATES.map((s) => mastery(s).color),
    ["#c9c6bd", "#d97706", "#4a6fa5", "#2d7a4c", "#14462c"],
  );
  assert.deepEqual(MASTERY_STATES.map((s) => mastery(s).ring), [0, 0.25, 0.5, 0.78, 1]);
  assert.equal(mastery("Nonsense").state, "Not started");
  assert.equal(mastery(undefined).state, "Not started");
});

// ---------------------------------------------------------------------------
// memory strength — an estimate, and honest about having no data
// ---------------------------------------------------------------------------

function learning(sm2s: { repetitions: number; interval: number; ease_factor: number }[]): LearningData {
  return {
    projectDir: "/x",
    present: [],
    mission: { destination: "", artifact: "", drivingProject: "" },
    plan: { sequence: [], cutList: [] },
    schema: {
      concepts: sm2s.map((sm2, i) => ({
        name: `c${i}`,
        badge: "🟨",
        label: "Fair",
        due: "upcoming",
        sm2: { last_tested: "2026-09-01", next_review: "2026-09-20", ...sm2 },
      })),
      misconceptions: [],
    },
  };
}

test("no concepts, or nothing reviewed, reports insufficient data rather than 0%", () => {
  assert.equal(memoryStrength(null).value, null);
  assert.equal(memoryStrength(learning([])).value, null);
  const unreviewed = memoryStrength(learning([{ repetitions: 0, interval: 0, ease_factor: 2.5 }]));
  assert.equal(unreviewed.value, null);
  assert.equal(unreviewed.reviewed, 0);
  assert.equal(unreviewed.total, 1);
});

test("the estimate is monotone in reviews, interval and ease, and stays within 0..1", () => {
  const weak = memoryStrength(learning([{ repetitions: 1, interval: 1, ease_factor: 1.3 }])).value!;
  const mid = memoryStrength(learning([{ repetitions: 2, interval: 4, ease_factor: 2.5 }])).value!;
  const strong = memoryStrength(learning([{ repetitions: 5, interval: 30, ease_factor: 2.5 }])).value!;
  assert.ok(weak < mid && mid < strong, `${weak} < ${mid} < ${strong}`);
  assert.ok(strong > 0.95, "a fully reviewed concept approaches 1");
  for (const v of [weak, mid, strong]) assert.ok(v >= 0 && v <= 1);
});

// ---------------------------------------------------------------------------
// list logic
// ---------------------------------------------------------------------------

const course = (over: Partial<CourseRef>): CourseRef =>
  ({
    id: "c",
    dir: "/c",
    label: "Label",
    title: "Title",
    concepts: 0,
    masteryCounts: {},
    sessions: { count: 0, lastAt: null },
    fromStore: true,
    ...over,
  }) as CourseRef;

test("filterCourses matches label and title, and returns everything for a blank query", () => {
  const courses = [
    course({ id: "a", label: "React internals", title: "trace a render cycle" }),
    course({ id: "b", label: "Supabase RLS", title: "hide pending rows" }),
  ];
  assert.equal(filterCourses(courses, "").length, 2);
  assert.deepEqual(filterCourses(courses, "react").map((c) => c.id), ["a"]);
  assert.deepEqual(filterCourses(courses, "render").map((c) => c.id), ["a"], "matches the title too");
  assert.deepEqual(filterCourses(courses, "pending").map((c) => c.id), ["b"]);
  assert.deepEqual(filterCourses(courses, "  RLS  ").map((c) => c.id), ["b"], "trimmed and case-insensitive");
  assert.deepEqual(filterCourses(courses, "zzz"), []);
});

test("mostRecent ignores courses with no journal, so the strip cannot invent a resume point", () => {
  assert.equal(mostRecent([]), null);
  assert.equal(mostRecent([course({ id: "a" })]), null, "no sessions anywhere");
  assert.equal(
    mostRecent([course({ id: "a", sessions: { count: 2, lastAt: null } })]),
    null,
    "a count without a timestamp is not usable",
  );

  const pick = mostRecent([
    course({ id: "old", sessions: { count: 5, lastAt: "2026-09-01T00:00:00.000Z" } }),
    course({ id: "new", sessions: { count: 1, lastAt: "2026-09-10T07:41:00.000Z" } }),
    course({ id: "none" }),
  ]);
  assert.equal(pick?.id, "new", "most recent wins, not most sessions");
});

test("totalMasteryCounts sums per-state counts across courses and tolerates gaps", () => {
  const totals = totalMasteryCounts(
    [
      course({ masteryCounts: { Mastered: 1, Familiar: 2 } as never }),
      course({ masteryCounts: { Mastered: 2, Proficient: 1 } as never }),
      course({ masteryCounts: {} as never }),
    ],
    MASTERY_STATES,
  );
  assert.deepEqual(totals, {
    "Not started": 0,
    Attempted: 0,
    Familiar: 2,
    Proficient: 1,
    Mastered: 3,
  });
});

// ---------------------------------------------------------------------------
// module taxonomy — vocabulary and rendering, not screens
// ---------------------------------------------------------------------------

test("every module type has a label and an icon glyph, including the four taxonomy additions", () => {
  assert.equal(ALL_MODULE_TYPES.length, 16, "12 authored + 4 derived");
  assert.deepEqual(
    Object.keys(MODULE_PATHS).sort(),
    [...ALL_MODULE_TYPES].sort(),
    "the glyph table is exhaustive, so a new type cannot render blank",
  );
  assert.deepEqual(Object.keys(MODULE_LABELS).sort(), [...ALL_MODULE_TYPES].sort());

  for (const type of ALL_MODULE_TYPES) {
    assert.ok(moduleTypeLabel(type).length > 0, `${type} has a label`);
    assert.ok(MODULE_PATHS[type].length > 0, `${type} has a glyph`);
  }

  assert.equal(moduleTypeLabel("course-challenge"), "Course challenge");
  assert.equal(moduleTypeLabel("primary-source"), "Primary source");
  assert.equal(moduleTypeLabel("faq"), "FAQ");
  assert.equal(moduleTypeLabel("ai-activity"), "AI activity");

  // the four additions are distinct from their neighbours in the vocabulary
  assert.notEqual(MODULE_PATHS["course-challenge"], MODULE_PATHS.test);
  assert.notEqual(MODULE_PATHS["primary-source"], MODULE_PATHS.article);
  assert.notEqual(MODULE_PATHS.faq, MODULE_PATHS.quiz);
  assert.notEqual(MODULE_PATHS["ai-activity"], MODULE_PATHS.recite);
});

// ---------------------------------------------------------------------------
// the catalogue is the store: every course in it was started by the learner
// ---------------------------------------------------------------------------

test("every course in the store reaches the catalogue — there is nothing to filter", () => {
  // The scan and the registry are gone, so hidden/initiated no longer exist: a course is in the
  // catalogue because the learner started it, and its count is simply how many there are.
  const courses = [course({ id: "a", label: "A" }), course({ id: "b", label: "B" })];
  assert.deepEqual(catalogueCourses(courses).map((c) => c.id), ["a", "b"]);
  assert.equal(catalogueCourses(courses).length, 2);
});

// ---------------------------------------------------------------------------
// streaming: thinking must never reach the visible prose
// ---------------------------------------------------------------------------

test("wire thinking and prose are kept apart", () => {
  let t = emptyTurn();
  t = reduceTurn(t, { type: "thinking_delta", delta: "the learner assumes " });
  t = reduceTurn(t, { type: "thinking_delta", delta: "setState is sync" });
  t = reduceTurn(t, { type: "text_delta", delta: "What does the console print?" });
  const split = splitTurn(t);
  assert.equal(split.thinking, "the learner assumes setState is sync");
  assert.equal(split.prose, "What does the console print?");
  assert.equal(split.prose.includes("setState is sync"), false, "thinking never leaks into prose");
  assert.equal(isSilent(t), false);
});

test("inline <thinking> is moved to the drawer, including across chunk boundaries", () => {
  let t = emptyTurn();
  // the tag is split across two deltas — splitting per delta would leak "<thin" into the prose
  t = reduceTurn(t, { type: "text_delta", delta: "Before <thin" });
  t = reduceTurn(t, { type: "text_delta", delta: "king>secret</thinking> after" });
  const split = splitTurn(t);
  assert.equal(split.thinking, "secret");
  assert.equal(split.prose, "Before  after");
  assert.equal(split.prose.includes("secret"), false);
  assert.equal(split.prose.includes("thinking>"), false);
});

test("an unterminated <thinking> block is still treated as reasoning while streaming", () => {
  const t = reduceTurn(emptyTurn(), { type: "text_delta", delta: "<thinking>still arriving" });
  const split = splitTurn(t);
  assert.equal(split.prose, "", "nothing visible yet");
  assert.equal(split.thinking, "still arriving");
  assert.equal(splitTurn(emptyTurn()).prose, "");
  assert.equal(isSilent(emptyTurn()), true);
});

test("a Thinking: line is tucked into the drawer and removed from the prose", () => {
  const t = reduceTurn(emptyTurn(), {
    type: "text_delta",
    delta: "Thinking: maybe they think it is synchronous\nSlope is rise over run.",
  });
  const split = splitTurn(t);
  assert.equal(split.thinking, "maybe they think it is synchronous");
  assert.equal(split.prose, "Slope is rise over run.");
});

test("both sources of reasoning are combined, and unknown events are ignored", () => {
  let t = reduceTurn(emptyTurn(), { type: "thinking_delta", delta: "wire thought" });
  t = reduceTurn(t, { type: "text_delta", delta: "<thinking>inline thought</thinking>visible" });
  t = reduceTurn(t, { type: "tool_call", delta: "ignored" });
  t = reduceTurn(t, undefined);
  const split = splitTurn(t);
  assert.equal(split.thinking, "wire thought\n\ninline thought");
  assert.equal(split.prose, "visible");
});

test("scroll keys are per course and unit, and absent storage is not fatal", () => {
  assert.equal(courseScrollKey("alg", 3), "alg:3");
  assert.equal(courseScrollKey("alg", null), "alg:1");
  // no window in this environment: both helpers must degrade rather than throw
  assert.equal(readPaneScroll("alg:3"), null);
  assert.doesNotThrow(() => savePaneScroll("alg:3", 120));
});

// ---------------------------------------------------------------------------
// answer checking (the client owns this rule)
// ---------------------------------------------------------------------------

test("numeric answers compare numerically so 3 accepts 3.0 and padded input", () => {
  assert.equal(isCorrect({ answer: "3", accepts: [] }, "3"), true);
  assert.equal(isCorrect({ answer: "3", accepts: [] }, " 3.0 "), true);
  assert.equal(isCorrect({ answer: "3", accepts: [] }, "4"), false);
  assert.equal(isCorrect({ answer: "3", accepts: [] }, ""), false);
  assert.equal(isCorrect({ answer: "1,000", accepts: [] }, "1000"), true);
});

test("text answers normalise case, whitespace and trailing punctuation, and accepts widens the match", () => {
  const item = { answer: "status = 'approved'", accepts: ["status='approved'"] };
  assert.equal(isCorrect(item, "STATUS = 'APPROVED'"), true);
  assert.equal(isCorrect(item, "status='approved'"), true, "via accepts");
  assert.equal(isCorrect(item, "status = 'pending'"), false);
});

// ---------------------------------------------------------------------------
// the quiz state machine — every branch
// ---------------------------------------------------------------------------

const item = (over: Partial<AssessmentItem> = {}): AssessmentItem => ({
  id: "q1",
  prompt: "p",
  answer: "3",
  mode: "short-answer",
  accepts: [],
  hints: ["h1", "h2", "h3"],
  steps: ["s1", "s2", "s3"],
  ...over,
});

test("the two-mistake gate opens exactly on the second mistake, not before", () => {
  let s = initQuiz(3);
  s = setAnswer(s, "4");
  s = check(s, item());
  assert.equal(s.mistakes, 1);
  assert.equal(s.gateOpen, false, "one mistake is not a gate");
  assert.equal(s.feedback, "incorrect");
  assert.equal(s.wrong, true);

  s = tryAgain(s);
  assert.equal(s.wrong, false, "the input is editable again");

  s = check(s, item());
  assert.equal(s.mistakes, 2);
  assert.equal(s.gateOpen, true, "the gate opens on the second mistake");
  assert.equal(s.totalMistakes, 2);
});

test("a correct answer locks the item, marks the dot, and never opens the gate", () => {
  let s = initQuiz(3);
  s = setAnswer(s, "3.0");
  s = check(s, item());
  assert.equal(s.locked, true);
  assert.equal(s.feedback, "correct");
  assert.equal(s.dots[0], "right");
  assert.equal(s.gateOpen, false);
  assert.equal(setAnswer(s, "9").answer, "3.0", "a locked item cannot be edited");
  assert.equal(check(s, item()).locked, true, "re-checking a locked item changes nothing");
});

test("the primary action cycles Check → Try again → Next → Finish", () => {
  let s = initQuiz(2);
  assert.equal(actionLabel(s), "Check");
  s = setAnswer(s, "4");
  s = check(s, item());
  assert.equal(actionLabel(s), "Try again");
  s = tryAgain(s);
  assert.equal(actionLabel(s), "Check");
  s = setAnswer(s, "3");
  s = check(s, item());
  assert.equal(actionLabel(s), "Next");
  s = nextItem(s);
  assert.equal(s.index, 1);
  assert.equal(actionLabel(s), "Check", "a fresh item is back to Check");
  s = setAnswer(s, "3");
  s = check(s, item());
  assert.equal(actionLabel(s), "Finish", "the last item finishes");
});

test("Skip is withdrawn once wrong, and a wrong dot is recorded", () => {
  let s = initQuiz(3);
  assert.equal(canSkip(s), true);
  s = setAnswer(s, "9");
  s = check(s, item());
  assert.equal(canSkip(s), false);
  assert.equal(s.dots[0], "wrong");
});

test("hints are revealed one at a time and stop at the last one", () => {
  let s = initQuiz(2);
  assert.equal(s.hintsShown, 0);
  s = showHint(s, item());
  assert.equal(s.hintsShown, 1);
  s = showHint(s, item());
  s = showHint(s, item());
  assert.equal(s.hintsShown, 3);
  s = showHint(s, item());
  assert.equal(s.hintsShown, 3, "there is no 4/3");
});

test("next advances, resets per-item state, and moving on clears the gate", () => {
  let s = initQuiz(3);
  s = setAnswer(s, "9");
  s = check(s, item());
  s = check(s, item());
  s = showHint(s, item());
  assert.equal(s.gateOpen, true);

  s = nextItem(s);
  assert.equal(s.index, 1);
  assert.equal(s.mistakes, 0, "mistakes are per attempt");
  assert.equal(s.hintsShown, 0);
  assert.equal(s.gateOpen, false);
  assert.equal(s.answer, "");
  assert.equal(s.locked, false);
  assert.equal(s.feedback, "none");
  assert.equal(s.totalMistakes, 2, "the running total survives");
  assert.deepEqual(s.dots, ["wrong", "current", "pending"]);
});

test("the last Next finishes the quiz rather than running off the end", () => {
  let s = initQuiz(1);
  s = nextItem(s);
  assert.equal(s.done, true);
  assert.equal(nextItem(s).index, 0, "a finished quiz does not advance");
});

test("Start over resets everything: index, dots, hints and mistakes", () => {
  let s = initQuiz(3);
  s = setAnswer(s, "9");
  s = check(s, item());
  s = check(s, item());
  s = showHint(s, item());
  s = nextItem(s);

  s = restart(s);
  assert.equal(s.index, 0);
  assert.equal(s.mistakes, 0);
  assert.equal(s.totalMistakes, 0);
  assert.equal(s.hintsShown, 0);
  assert.equal(s.gateOpen, false);
  assert.equal(s.done, false);
  assert.deepEqual(s.dots, ["current", "pending", "pending"], "a full reset, not a partial one");
});

test("Keep going dismisses the gate but leaves the attempt otherwise untouched", () => {
  let s = initQuiz(2);
  s = setAnswer(s, "9");
  s = check(s, item());
  s = check(s, item());
  const kept = dismissGate(s);
  assert.equal(kept.gateOpen, false);
  assert.equal(kept.mistakes, 2, "the mistakes still count");
  assert.equal(kept.dots[0], "wrong");
  assert.equal(kept.answer, "9");
});

test("an empty answer is not checkable and does not count as a mistake", () => {
  let s = initQuiz(2);
  s = check(s, item());
  assert.equal(s.mistakes, 0);
  assert.equal(s.feedback, "none");
  assert.equal(setAnswer(s, "   ").answer, "   ", "whitespace alone still cannot be checked");
  assert.equal(check({ ...s, answer: "   " }, item()).mistakes, 0);
});

test("the score counts right and wrong dots", () => {
  let s = initQuiz(3);
  s = setAnswer(s, "3");
  s = check(s, item());
  s = nextItem(s);
  s = setAnswer(s, "9");
  s = check(s, item());
  assert.deepEqual(score(s), { right: 1, wrong: 1 });
});

// ---------------------------------------------------------------------------
// the completion screen may only claim what a field backs
// ---------------------------------------------------------------------------

test("with no mastery field on the response, no mastery claim is rendered", () => {
  const view = completionView({ right: 3, wrong: 0, total: 3, recorded: true, mastery: null });
  assert.equal(view.masteryLine, null, "a mastery claim with no backing field must not render");
  assert.equal(view.scoreLine, "3 of 3 correct · no mistakes");
  assert.equal(view.recordedLine, "This attempt was recorded in the course history.");
  assert.equal(view.heading, "Nice work.");
});

test("an absent mastery field behaves exactly like a null one", () => {
  const omitted = completionView({ right: 1, wrong: 2, total: 3, recorded: true });
  assert.equal(omitted.masteryLine, null);
  const blank = completionView({ right: 1, wrong: 2, total: 3, recorded: true, mastery: "   " });
  assert.equal(blank.masteryLine, null, "whitespace is not a mastery value");
  assert.equal(blank.scoreLine, "1 of 3 correct · 2 answered wrong");
});

test("a mastery claim renders only when the response actually carries one", () => {
  const view = completionView({ right: 3, wrong: 0, total: 3, recorded: true, mastery: "Proficient" });
  assert.equal(view.masteryLine, "Skill moved to Proficient");
});

test("a qualified badge is reported as a qualification, never as a moved badge", () => {
  const view = completionView({
    right: 3,
    wrong: 0,
    total: 3,
    recorded: true,
    mastery: null,
    pendingBadge: { concept: "idempotent-migrations", badge: "🟩", state: "Proficient" },
  });
  assert.equal(view.masteryLine, null, "the FILE has not moved, so no mastery claim");
  assert.match(view.pendingLine!, /qualifies idempotent-migrations for Proficient/);
  assert.match(view.pendingLine!, /next time a tutor session runs/);
  assert.equal(/Skill moved/.test(view.pendingLine!), false);
});

test("no pending badge means no pending line", () => {
  const none = completionView({ right: 1, wrong: 2, total: 3, recorded: true });
  assert.equal(none.pendingLine, null);
  const blank = completionView({
    right: 1,
    wrong: 2,
    total: 3,
    recorded: true,
    pendingBadge: { concept: "x", badge: "", state: "" },
  });
  assert.equal(blank.pendingLine, null, "an empty state is not a qualification");
});

test("a failed recording says so rather than claiming history", () => {
  const view = completionView({
    right: 2,
    wrong: 1,
    total: 3,
    recorded: false,
    recordError: "HTTP 500",
  });
  assert.equal(view.recordedLine, "Not recorded: HTTP 500");
  assert.equal(view.masteryLine, null);
});

test("before the recording round-trips, nothing about the attempt is claimed", () => {
  const pending = completionView({ right: 3, wrong: 0, total: 3, recorded: false });
  assert.equal(pending.recordedLine, null, "no claim either way while the write is in flight");
  assert.equal(pending.masteryLine, null);
  assert.equal(pending.scoreLine, "3 of 3 correct · no mistakes", "the score is local and always true");
});

// ---------------------------------------------------------------------------
// expression evaluator — the interactive plot's engine
// ---------------------------------------------------------------------------

test("the evaluator computes an expression with parameters and x", () => {
  const c = compile("m * x + b");
  assert.equal(c.ok, true);
  if (!c.ok) return;
  assert.deepEqual(c.names.sort(), ["b", "m"], "parameters are discovered; x is not one");
  assert.equal(c.usesX, true);
  assert.equal(c.evaluate({ m: 3, b: -2, x: 1 }), 1);
  assert.equal(c.evaluate({ m: 3, b: -2, x: 0 }), -2);
  assert.equal(c.evaluate({ m: 0, b: 5, x: 9 }), 5);
});

test("operator precedence and associativity are right", () => {
  const at = (src: string, scope: Record<string, number> = {}) => {
    const c = compile(src);
    assert.equal(c.ok, true, `${src} should compile`);
    return c.ok ? c.evaluate(scope) : NaN;
  };
  assert.equal(at("2 + 3 * 4"), 14, "multiplication binds tighter");
  assert.equal(at("(2 + 3) * 4"), 20);
  assert.equal(at("2 ^ 3 ^ 2"), 512, "power is right associative");
  assert.equal(at("-2 ^ 2"), -4, "unary minus binds looser than power");
  assert.equal(at("10 / 2 / 5"), 1, "division is left associative");
});

test("functions and constants work, and unknown names are refused", () => {
  const c = compile("max(sin(pi / 2), 0) + sqrt(9)");
  assert.equal(c.ok, true);
  if (c.ok) assert.equal(c.evaluate({}), 4);

  const unknownFn = compile("frobnicate(x)");
  assert.equal(unknownFn.ok, false);
  if (!unknownFn.ok) assert.match(unknownFn.error, /unknown function/);

  assert.equal(compile("").ok, false);
  assert.equal(compile("2 +").ok, false);
  assert.equal(compile("(2 + 3").ok, false, "unbalanced parens");
  assert.equal(compile("2 3").ok, false, "trailing input");
  assert.equal(compile("x; process.exit(1)").ok, false, "no statement injection");
});

test("an unknown identifier evaluates to NaN, so it is skipped rather than plotted as 0", () => {
  const c = compile("a * x");
  assert.equal(c.ok, true);
  if (!c.ok) return;
  assert.equal(Number.isNaN(c.evaluate({ x: 1 })), true);
  assert.deepEqual(sample(c, { x: 1 }, { min: 0, max: 1 }, 3), [], "no points survive NaN");
});

test("sample spans the range inclusively and skips only non-finite results", () => {
  const c = compile("sqrt(x)");
  assert.equal(c.ok, true);
  if (!c.ok) return;
  const points = sample(c, {}, { min: -4, max: 4 }, 8);
  assert.ok(points.length > 0 && points.length < 9, "negative roots are dropped");
  assert.equal(points[0].x > -4, true, "the first finite x is after the negative half");
  assert.equal(points.at(-1)!.x, 4, "the range's end is reached");

  const line = compile("x");
  if (!line.ok) return;
  const all = sample(line, {}, { min: -1, max: 1 }, 2);
  assert.deepEqual(all, [{ x: -1, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.deepEqual(sample(line, {}, { min: 5, max: 5 }, 10), [], "an empty span yields nothing");
});

// ---------------------------------------------------------------------------
// launch-window game logic
// ---------------------------------------------------------------------------

const GAME = { kind: "target-window" as const, speed: 1, band: [40, 60] as [number, number] };

test("the marker sweeps 0..100 and back, deterministically", () => {
  assert.equal(markerAt(0, 1), 0);
  assert.equal(markerAt(0.5, 1), 100, "half a period is the far end");
  assert.equal(markerAt(1, 1), 0, "a full period returns home");
  assert.equal(markerAt(0.25, 1), 50);
  assert.equal(markerAt(-0.25, 1), 50, "negative time is handled too");
});

test("launching inside the band hits, outside it misses", () => {
  const inBand = launch({ ...initGame(), marker: 50 }, GAME);
  assert.equal(inBand.outcome, "hit");
  assert.equal(inBand.shots, 1);
  assert.equal(inBand.hits, 1);
  assert.match(inBand.message, /Insertion/);

  const outside = launch({ ...initGame(), marker: 10 }, GAME);
  assert.equal(outside.outcome, "miss");
  assert.equal(outside.hits, 0);
  assert.match(outside.message, /Relaunch/);
});

test("the band's edges are inclusive", () => {
  assert.equal(launch({ ...initGame(), marker: 40 }, GAME).outcome, "hit");
  assert.equal(launch({ ...initGame(), marker: 60 }, GAME).outcome, "hit");
  assert.equal(launch({ ...initGame(), marker: 39.9 }, GAME).outcome, "miss");
});

test("a second launch mid-flight is ignored, so double-pressing cannot cheat", () => {
  const first = launch({ ...initGame(), marker: 50 }, GAME);
  const second = launch(first, GAME);
  assert.equal(second, first, "the state is returned untouched");
  assert.equal(second.shots, 1);
});

test("the arc clears after its delay and the marker resumes", () => {
  let state = launch({ ...initGame(), marker: 10 }, GAME);
  assert.equal(state.phase, "resolved");
  state = tick(state, 0.5, GAME);
  assert.equal(state.phase, "resolved", "still clearing");
  state = tick(state, CLEAR_AFTER_SECONDS, GAME);
  assert.equal(state.phase, "idle");
  assert.equal(state.outcome, null);
  assert.equal(state.shots, 1, "the tally survives the reset");
});

test("tick advances the marker and tolerates a zero or negative delta", () => {
  const t1 = tick(initGame(), 0.25, GAME);
  assert.equal(t1.marker, 50);
  assert.equal(tick(t1, 0, GAME).t, t1.t, "no time passes");
  assert.equal(tick(t1, -5, GAME).t, t1.t, "negative dt does not rewind");
});

test("accuracy is null until a shot is taken", () => {
  assert.equal(accuracy(initGame()), null);
  let state = launch({ ...initGame(), marker: 50 }, GAME);
  assert.equal(accuracy(state), 1);
  state = tick(state, CLEAR_AFTER_SECONDS + 0.1, GAME);
  state = launch({ ...state, marker: 0 }, GAME);
  assert.equal(accuracy(state), 0.5);
});

test("the band fraction maps to bar geometry", () => {
  assert.deepEqual(bandFraction([40, 60]), { start: 0.4, width: 0.2 });
  assert.deepEqual(bandFraction([-10, 200]), { start: 0, width: 1 });
});

// ---------------------------------------------------------------------------
// expr.ts must stay importable by the SERVER
// ---------------------------------------------------------------------------

test("expr.ts imports nothing and touches no browser global", () => {
  // The server imports this module to validate a spec, so there is one opinion about what a formula
  // means. That is only safe while the file stays pure — a single `window` or `document` reference
  // would break every server-side validation at import time, and the failure would look like a
  // broken feature rather than a misplaced global.
  const url = new URL("./expr.ts", import.meta.url);
  const source = readFileSync(url, "utf8");

  // Strip comments first: prose about `window` is not a reference to it.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const forbidden = [
    "window",
    "document",
    "navigator",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "fetch",
    "XMLHttpRequest",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "process",
    "require",
  ];
  // Identifier match WITHOUT any backslashes: `\b` in a template literal is the backspace
  // character, not a regex word boundary, so `new RegExp(`\b${name}\b`)` silently matches nothing
  // and the guard passes while violating its own premise.
  const isIdentifier = (src: string, name: string) =>
    new RegExp("(^|[^A-Za-z0-9_$])" + name + "([^A-Za-z0-9_$]|$)").test(src);

  for (const name of forbidden) {
    assert.equal(isIdentifier(code, name), false, `expr.ts must not reference ${name}`);
  }

  assert.equal(/^\s*import\s/m.test(code), false, "expr.ts imports nothing, so it has no dependencies");
  assert.equal(/^\s*export\s+default/m.test(code), false, "no default export that could carry state");
});

// ---------------------------------------------------------------------------
// P8 — the grading contract
// ---------------------------------------------------------------------------

test("normalisation folds case, whitespace, quotes and trailing punctuation", () => {
  // The real bug: a correct paraphrase was marked wrong. These are the presentation differences
  // that must NOT decide an answer.
  assert.equal(isCorrect({ answer: "select", accepts: [] }, "SELECT."), true);
  assert.equal(isCorrect({ answer: "select", accepts: [] }, "  select  "), true);
  assert.equal(isCorrect({ answer: "status = 'approved'", accepts: [] }, "STATUS  =  'APPROVED'"), true);
  assert.equal(isCorrect({ answer: "locations", accepts: [] }, "\u201clocations\u201d"), true, "curly quotes");
  assert.equal(isCorrect({ answer: "drop policy", accepts: [] }, "'drop policy'"), true, "surrounding quotes");
  assert.equal(isCorrect({ answer: "3", accepts: [] }, "3."), true);
});

test("normalisation keeps internal punctuation, so wrong answers stay wrong", () => {
  // Over-normalising would trade a false negative for a false positive, which is worse.
  assert.equal(isCorrect({ answer: "status = 'approved'", accepts: [] }, "status approved"), false);
  assert.equal(isCorrect({ answer: "drop policy if exists", accepts: [] }, "drop policy exists"), false);
  assert.equal(isCorrect({ answer: "select", accepts: [] }, "insert"), false);
});

test("a short-answer item auto-grades a differently-presented correct answer", () => {
  const item = { answer: "status = 'approved'", accepts: ["status='approved'"], mode: "short-answer" as const };
  assert.equal(isCorrect(item, "status = 'approved'."), true);
  assert.equal(isCorrect(item, "  STATUS='approved'  "), true, "via accepts, without spaces");
  assert.equal(isCorrect(item, "status = 'pending'"), false);
});

test("a self-check item never auto-grades, however exact the match", () => {
  const item = {
    answer: "The CREATE POLICY statement fails; guard it by dropping it first.",
    accepts: [],
    mode: "self-check" as const,
  };
  assert.equal(isCorrect(item, item.answer), false, "even the verbatim answer is not graded here");
  assert.equal(gradingMode(item), "self-check");
  assert.equal(gradingMode({}), "short-answer", "an absent mode defaults to auto-graded");
});

test("check() refuses to auto-grade a self-check item", () => {
  const item = {
    id: "q",
    prompt: "why?",
    answer: "because the policy already exists",
    mode: "self-check" as const,
    accepts: [],
    hints: ["h"],
    steps: ["s"],
    };
  let s = initQuiz(1);
  s = setAnswer(s, item.answer);
  const after = check(s, item);
  assert.equal(after.locked, false, "nothing was graded");
  assert.equal(after.mistakes, 0, "and no mistake was recorded against the learner");
  assert.equal(after.feedback, "none");
  assert.equal(after, s, "the state is returned untouched");
});

test("reveal() shows the solution without grading, and judge() is what locks it", () => {
  const item = {
    id: "q",
    prompt: "why?",
    answer: "because the policy already exists",
    mode: "self-check" as const,
    accepts: [],
    hints: [],
    steps: ["because the policy already exists"],
    };
  let s = initQuiz(1);
  s = setAnswer(s, "my own words that differ completely");
  s = reveal(s, item);
  assert.equal(s.solutionOpen, true);
  assert.equal(s.locked, false, "revealing is not grading");
  assert.equal(actionLabel(s, item), "Show solution");

  s = judge(s, true);
  assert.equal(s.locked, true);
  assert.equal(s.feedback, "correct");
  assert.equal(s.dots[0], "right");
  assert.equal(actionLabel(s, item), "Finish");
  assert.equal(judge(s, false).locked, true, "a locked item cannot be re-judged");
});

test("a self-check verdict counts once toward the attempt and never opens the gate", () => {
  // One verdict per item: the solution has been revealed, so re-judging is meaningless and the
  // PER-ITEM gate (two mistakes on one attempt) cannot open here. The verdict still counts toward
  // the attempt's total, which is what the mastery mapping reads.
  const item = {
    id: "q",
    prompt: "p",
    answer: "a",
    mode: "self-check" as const,
    accepts: [],
    hints: [],
    steps: ["a"],
    };
  let s = initQuiz(2);
  s = judge(s, false);
  assert.equal(s.mistakes, 1);
  assert.equal(s.totalMistakes, 1, "the attempt's tally counts it");
  assert.equal(s.gateOpen, false);
  assert.equal(s.dots[0], "wrong");
  assert.equal(s.feedback, "incorrect");

  assert.equal(judge(s, false), s, "a judged item cannot be judged again");
  assert.equal(judge(s, true).feedback, "incorrect", "nor re-judged as right");
  assert.equal(judge(s, true).totalMistakes, 1, "and cannot double-count");

  assert.equal(reveal(s, item), s, "nor re-revealed after judging");
});

test("a short-answer item still offers Check, and a self-check offers Show solution", () => {
  const short = { mode: "short-answer" as const } as AssessmentItem;
  const prose = { mode: "self-check" as const } as AssessmentItem;
  const fresh = initQuiz(2);
  assert.equal(actionLabel(fresh, short), "Check");
  assert.equal(actionLabel(fresh, prose), "Show solution");
  assert.equal(actionLabel(fresh), "Check", "no item means the default label");
  assert.equal(canSkip(fresh), true, "Skip is available on a self-check item too");
});

// ---------------------------------------------------------------------------
// P9 — grill dispatch
// ---------------------------------------------------------------------------

test("the grill prompt is the mechanism, and is exactly what the original posted", () => {
  // Ported from 06cee66^:public/app.js:84 — `chat(`/skill:grill-misconception ${c.name}`)`
  assert.equal(grillPrompt("react-state"), "/skill:grill-misconception react-state");
  assert.equal(grillPrompt("  idempotent-migrations  "), "/skill:grill-misconception idempotent-migrations");
  assert.equal(isGrillPrompt(grillPrompt("x")), true);
  assert.equal(isGrillPrompt("what is state?"), false);
});

test("a grill href round-trips its prompt", () => {
  const href = grillHref("DriftScout", 2, "rls-policies");
  assert.match(href, /^#\/lesson\/DriftScout\/2\?ask=/);
  assert.equal(parseAsk(href), "/skill:grill-misconception rls-policies");
});

test("the ask parameter does not corrupt the unit it travels with", () => {
  // Regression guard: splitting the query late fed `1?ask=%2Fskill...` to Number(), which is NaN, which
  // silently fell back to unit 1 — the grill would have opened the wrong unit every time.
  const route = parseHash(grillHref("DriftScout", 3, "client-data-flow"));
  assert.equal(route.name, "lesson");
  if (route.name !== "lesson") return;
  assert.equal(route.courseId, "DriftScout");
  assert.equal(route.unit, 3, "the unit survives the query string");
  assert.equal(route.ask, "/skill:grill-misconception client-data-flow");
});

test("a lesson without an ask is unchanged, and the other routes still parse", () => {
  const plain = parseHash("#/lesson/alg/2");
  assert.equal(plain.name, "lesson");
  if (plain.name === "lesson") assert.equal(plain.ask, null);

  assert.equal(parseHash("#/home").name, "home");
  assert.equal(parseHash("").name, "home");
  const course = parseHash("#/course/alg/3");
  assert.equal(course.name, "course");
  if (course.name === "course") assert.equal(course.unit, 3);
  assert.equal(parseHash("#/quiz/alg/1").name, "quiz");
  assert.equal(parseHash("#/lab/alg/1").name, "lab");
  assert.equal(parseHash("#/nonsense").name, "unknown");
});

test("an empty or absent ask is null, never an empty prompt", () => {
  assert.equal(parseAsk("#/lesson/x/1"), null);
  assert.equal(parseAsk("#/lesson/x/1?ask="), null);
  assert.equal(parseAsk("#/lesson/x/1?ask=%20%20"), null);
  assert.equal(parseAsk("#/lesson/x/1?other=1&ask=hi"), "hi");
});

// ---------------------------------------------------------------------------
// P10 — the sprint rest gate
// ---------------------------------------------------------------------------

test("all three gate tokens are recognised, and the earliest one wins", () => {
  // Ported from app.js:25 — GATE_TOKENS verbatim.
  assert.equal(findGateToken("blah COGNITIVE SPRINT GATE blah"), "COGNITIVE SPRINT GATE");
  assert.equal(findGateToken("blah SPRINT_GATE blah"), "SPRINT_GATE");
  assert.equal(findGateToken("blah SPRINT GATE blah"), "SPRINT GATE");
  assert.equal(findGateToken("nothing here"), null);
  assert.equal(findGateToken(""), null);
  assert.equal(findGateToken("SPRINT GATE then SPRINT_GATE"), "SPRINT GATE", "earliest wins");
});

test("the token is a control signal: everything from it onward is suppressed", () => {
  const split = splitAtGate("Here is your question.\n\nSPRINT_GATE\n\nTake a break, you have earned it.");
  assert.equal(split.token, "SPRINT_GATE");
  assert.equal(split.prose, "Here is your question.", "the gate copy is never shown as prose");
  assert.equal(split.prose.includes("Take a break"), false);

  const clean = splitAtGate("just an answer");
  assert.equal(clean.token, null);
  assert.equal(clean.prose, "just an answer", "no token means no truncation");
});

test("a token straddling two deltas is still caught", () => {
  // The original tested each delta in isolation, so `SPRINT_GATE` split across chunks was missed.
  let t = emptyTurn();
  t = reduceTurn(t, { type: "text_delta", delta: "answer\n\nSPRI" });
  t = reduceTurn(t, { type: "text_delta", delta: "NT_GATE\n\nrest now" });
  const split = splitAtGate(splitTurn(t).prose);
  assert.equal(split.token, "SPRINT_GATE");
  assert.equal(split.prose, "answer");
});

test("the countdown formats as mm:ss, the way the original did", () => {
  assert.equal(formatCountdown(300), "05:00");
  assert.equal(formatCountdown(299), "04:59");
  assert.equal(formatCountdown(60), "01:00");
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-5), "00:00", "never negative");
  assert.equal(formatCountdown(9), "00:09");
});

test("the gate freezes the composer for the whole countdown, then releases it", () => {
  assert.equal(isFrozen(true, 300), true);
  assert.equal(isFrozen(true, 1), true);
  assert.equal(isFrozen(true, 0), false, "released exactly at zero");
  assert.equal(isFrozen(false, 300), false, "an unopened gate freezes nothing");
  assert.equal(REST_SECONDS, 300, "five minutes, as the original hard-coded");
});

// ---------------------------------------------------------------------------
// P11 — the passivity intercept
// ---------------------------------------------------------------------------

test("the passive regex is ported verbatim and matches what it always matched", () => {
  for (const word of ["ok", "OK", "okay", "k", "kk", "cool", "got it", "gotit", "makes sense", "next", "proceed",
    "continue", "go on", "y", "yes", "yeah", "sure", "fine", "right", "nice", "great", "...", "   ok   "]) {
    assert.equal(isPassiveText(word), true, `${word} should read as passive`);
  }
  for (const word of ["", "state is a snapshot", "no", "yes but the closure is stale", "ok, but why?"]) {
    assert.equal(isPassiveText(word), false, `${JSON.stringify(word)} is not passive`);
  }
});

test("with no intercept active, nothing is gated — the original behaviour", () => {
  assert.equal(maySubmit(false, "ok"), true, "the old banner never blocked");
  assert.equal(maySubmit(false, "a real explanation"), true);
  assert.equal(refusalReason(false, "ok"), null);
});

test("with the intercept active, a passive draft is refused and an explanation is not", () => {
  assert.equal(maySubmit(true, "ok"), false, "BEHAVIOUR CHANGE: this is refused now");
  assert.equal(refusalReason(true, "ok"), "passive");
  assert.equal(maySubmit(true, "State is a snapshot taken when the render begins, not a live reference."), true);
  assert.equal(refusalReason(true, "a real explanation"), null, "and that is what clears it");
});

test("an empty draft is never submittable, intercept or not", () => {
  assert.equal(maySubmit(false, "   "), false);
  assert.equal(maySubmit(true, ""), false);
  assert.equal(refusalReason(true, "  "), null, "nothing is refused for being empty; it is just unsubmittable");
});

test("the trigger is the tutor's signal, not client-side detection", () => {
  // app.js:247-249 — `e.method === "notify" && e.message.includes("PASSIVITY")`
  assert.equal(isPassivitySignal({ type: "extension_ui_request", method: "notify", message: "PASSIVITY" }), true);
  assert.equal(
    isPassivitySignal({ type: "extension_ui_request", method: "notify", message: "⚠️ [PASSIVITY INTERCEPT] …" }),
    true,
  );
  assert.equal(isPassivitySignal({ type: "extension_ui_request", method: "notify", message: "something else" }), false);
  assert.equal(isPassivitySignal({ type: "message_update", method: "notify", message: "PASSIVITY" }), false);
  assert.equal(isPassivitySignal({ type: "extension_ui_request", method: "select", message: "PASSIVITY" }), false);
  assert.equal(isPassivitySignal(null), false);
});

// ---------------------------------------------------------------------------
// T-050 — the learner's own turns
// ---------------------------------------------------------------------------

test("a learner message is appended the moment it is sent", () => {
  const one = appendUser([], "Explain batching in one sentence.");
  assert.deepEqual(one, [{ role: "user", text: "Explain batching in one sentence." }]);
  assert.equal(one[0].role, "user");
  const two = appendUser(one, "  and what about two setState calls?  ");
  assert.equal(two.length, 2);
  assert.equal(two[1].text, "and what about two setState calls?", "trimmed");
  assert.equal(appendUser(one, "   ").length, 1, "an empty send adds nothing");
});

test("a settled tutor turn joins the transcript, and an empty one does not", () => {
  const after = settleAssistant([], "Same word, three mechanisms.");
  assert.deepEqual(after, [{ role: "assistant", text: "Same word, three mechanisms." }]);
  assert.deepEqual(settleAssistant([], "   "), [], "a turn with nothing visible adds nothing");
  assert.deepEqual(settleAssistant([], ""), []);
});

test("a gate-truncated reply settles as what the learner actually saw", () => {
  // The gate copy is a control signal, so it must not land in the transcript as prose.
  const settled = settleAssistant([], "Here is your question.\n\nSPRINT_GATE\n\nTake a break.");
  assert.deepEqual(settled, [{ role: "assistant", text: "Here is your question." }]);
});

test("the transcript interleaves in order and only reports empty when it is", () => {
  let h: ChatTurn[] = [];
  assert.equal(isTranscriptEmpty(h), true);
  h = appendUser(h, "q1");
  h = settleAssistant(h, "a1");
  h = appendUser(h, "q2");
  h = settleAssistant(h, "a2");
  assert.deepEqual(
    h.map((t) => `${t.role}:${t.text}`),
    ["user:q1", "assistant:a1", "user:q2", "assistant:a2"],
  );
  assert.equal(isTranscriptEmpty(h), false);
});

// ---------------------------------------------------------------------------
// T-044 — a started-but-empty course says so, and offers the path
// ---------------------------------------------------------------------------

test("the scaffold dispatch targets the scaffold skill, with a colon", () => {
  // `/skill:scaffold-learning` is explicit-invocation-only. A slash instead of a colon would invoke
  // nothing — the same typo class that was corrected in the P9 report.
  assert.equal(SCAFFOLD_SKILL, "/skill:scaffold-learning");
  assert.ok(SCAFFOLD_SKILL.includes(":"));
  assert.equal(scaffoldPrompt(), SCAFFOLD_SKILL);
});

test("the scaffold href is a lesson route carrying the prompt, and round-trips", () => {
  const href = scaffoldHref("unstarted-project");
  assert.match(href, /^#\/lesson\/unstarted-project\/1\?ask=/);
  assert.equal(parseAsk(href), "/skill:scaffold-learning");
  const route = parseHash(href);
  assert.equal(route.name, "lesson");
  if (route.name === "lesson") {
    assert.equal(route.courseId, "unstarted-project");
    assert.equal(route.unit, 1);
    assert.equal(route.ask, "/skill:scaffold-learning");
  }
});

test("the grill and scaffold dispatches share one mechanism", () => {
  // One route, one parser, one dispatch in the lesson: a second mechanism would be a second thing to
  // keep working.
  const grill = grillHref("c", 2, "hooks");
  assert.equal(parseAsk(grill), "/skill:grill-misconception hooks");
  assert.equal(grill.startsWith("#/lesson/c/2?ask="), true);
  assert.equal(scaffoldHref("c").startsWith("#/lesson/c/1?ask="), true);
  assert.notEqual(parseAsk(grill), parseAsk(scaffoldHref("c")));
});

// ---------------------------------------------------------------------------
// stream errors reach the learner as prose, never as a JSON literal
// ---------------------------------------------------------------------------

test("the [ERROR] wrapper is stripped so a learner never sees JSON", () => {
  // Observed live: a tutor turn rendered `{"error":"pi process exited"}` in the error strip.
  assert.equal(streamErrorText('[ERROR] {"error":"pi process exited"}'), "pi process exited");
  assert.equal(streamErrorText('[ERROR]{"error":"pi process exited"}'), "pi process exited");
});

test("a non-JSON error frame is shown as it arrived, not swallowed", () => {
  // A crashed process can emit anything; hiding it would remove the only clue.
  assert.equal(streamErrorText("[ERROR] boom"), "boom");
  assert.equal(streamErrorText('[ERROR] {"error": 42}'), '{"error": 42}');
  assert.equal(streamErrorText("[ERROR]"), "the turn failed with no message");
});

// ---------------------------------------------------------------------------
// the watch channel: a rename is how a page learns its id is stale
// ---------------------------------------------------------------------------

test("a renamed frame carries from and to, so an open page can follow it", () => {
  // Without this frame the page keeps requesting an id whose directory no longer exists. There is no
  // alias table by design, so following the frame is the only thing that keeps it on the course.
  assert.deepEqual(parseWatchFrame('{"type":"renamed","from":"old-name","to":"Wheel Alignment"}'), {
    kind: "renamed",
    from: "old-name",
    to: "Wheel Alignment",
  });
});

test("a reload frame still works, and anything else is ignored rather than guessed at", () => {
  assert.deepEqual(parseWatchFrame('{"type":"reload","course":"driftscout"}'), {
    kind: "reload",
    course: "driftscout",
  });
  // A half-formed rename must not be acted on: moving a page to `undefined` is worse than staying put.
  assert.equal(parseWatchFrame('{"type":"renamed","from":"only-a-from"}').kind, "other");
  assert.equal(parseWatchFrame('{"type":"renamed","to":"only-a-to"}').kind, "other");
  assert.equal(parseWatchFrame(": heartbeat").kind, "other");
  assert.equal(parseWatchFrame("not json at all").kind, "other");
});

// ---------------------------------------------------------------------------
// humanize: display names, never ids
// ---------------------------------------------------------------------------

test("identifier and authored text converge on Title Case", () => {
  // Both forms must produce the SAME string, because a course whose headings were written before the
  // convention existed cannot read differently from one scaffolded after it.
  assert.equal(humanize("wheel-anatomy-and-tension-model"), "Wheel Anatomy And Tension Model");
  assert.equal(humanize("Wheel anatomy and tension model"), "Wheel Anatomy And Tension Model");
  assert.equal(humanize("suspension-angle-vocabulary"), "Suspension Angle Vocabulary");
});

test("snake_case and mixed separators become words", () => {
  assert.equal(humanize("thrust_angle"), "Thrust Angle");
  assert.equal(humanize("string-method_setup"), "String Method Setup");
  assert.equal(humanize("a--b__c"), "A B C");
});

test("a hyphen splits into words and is dropped, on authored text too", () => {
  assert.equal(humanize("Front-toe"), "Front Toe");
  assert.equal(humanize("bump-steer-and-roll-centre"), "Bump Steer And Roll Centre");
});

test("a word with internal case is deliberate and is left alone", () => {
  // The whole of the cleverness, and it is a property of the word rather than a list of words: an
  // uppercase letter after the first character means somebody typed that casing on purpose. This is what
  // keeps `useState` from becoming `Usestate` and `iPhone` from becoming `IPhone`.
  assert.equal(humanize("useState"), "useState");
  assert.equal(humanize("iPhone"), "iPhone");
  assert.equal(humanize("KPI"), "KPI");
  assert.equal(humanize("McDonald"), "McDonald");
  assert.equal(humanize("getUserById"), "getUserById");
  // …and a lowercase word has no such signal, so it is cased normally.
  assert.equal(humanize("kpi"), "Kpi");
  assert.equal(humanize("E46"), "E46");
  assert.equal(humanize("e46-drift-target-spec"), "E46 Drift Target Spec");
});

test("connectives are capitalised like any other word — no small-word list", () => {
  // Proper title case would lowercase "and", "of" and "the". That needs a maintained list, and it is a
  // separate decision; this function has no such list on purpose.
  assert.equal(humanize("reading a wheel"), "Reading A Wheel");
  assert.equal(humanize("tensioning and stress relieving"), "Tensioning And Stress Relieving");
});

test("applying it twice is applying it once", () => {
  assert.equal(humanize(humanize("wheel-anatomy")), humanize("wheel-anatomy"));
  assert.equal(humanize(humanize("useState")), "useState");
  assert.equal(humanize(humanize("Camber and toe")), "Camber And Toe");
});

test("empty input, whitespace and bare separators produce nothing", () => {
  assert.equal(humanize(""), "");
  assert.equal(humanize("   "), "");
  assert.equal(humanize("-"), "");
  assert.equal(humanize("__"), "");
});

// ---------------------------------------------------------------------------
// the module's accessible name keeps the distinction the visible title drops
// ---------------------------------------------------------------------------

test("the three derived module titles do not repeat their own type", () => {
  // The row renders the type label beneath the title, so a leading verb in the title says it twice.
  assert.equal(moduleRingLabel("recite", "Suspension Angle Vocabulary", "Not started"), "Recite — Suspension Angle Vocabulary: Not started");
  assert.equal(moduleRingLabel("explain", "Suspension Angle Vocabulary in your own words", "Fair"), "Explain — Suspension Angle Vocabulary in your own words: Fair");
});

test("the three accessible names differ, though two visible titles are identical", () => {
  // This is the collision the visible change would otherwise create: a screen reader gets no "beneath".
  const title = "Suspension Angle Vocabulary";
  const labels = [
    moduleRingLabel("recite", title, "Not started"),
    moduleRingLabel("review", title, "Not started"),
    moduleRingLabel("explain", `${title} in your own words`, "Not started"),
  ];
  assert.equal(new Set(labels).size, 3, `labels must be distinct, got ${JSON.stringify(labels)}`);
  assert.ok(labels[0].startsWith("Recite — "), "the type leads");
  assert.ok(labels[1].startsWith("Review — "));
  assert.ok(labels[2].startsWith("Explain — "));
});

// ---------------------------------------------------------------------------
// the render-site guard: an identifier must not reach JSX
// ---------------------------------------------------------------------------

/**
 * The render-site guard.
 *
 * HONEST LIMIT: this is a TEXT SCAN over source files. It catches the shapes an identifier has taken
 * before — `{unit.title}` in JSX, `${card.name}` in a template literal — and it cannot catch a string
 * assembled at runtime (a `join` over data, a value passed through three functions). It is a net for the
 * known ways this bug appears, not a proof that none exists. Widened from `components/*.tsx` to the model
 * because display strings are ALSO assembled server-side, which is how `"${unit.title} quiz"` survived a
 * guard that only looked at the client.
 */
function scanForRawIdentifiers(
  files: { path: string; label: string }[],
  needles: string[],
  exemptLines: Set<string>,
): string[] {
  const offenders: string[] = [];
  const seenExempt = new Set<string>();
  for (const { path, label } of files) {
    const source = readFileSync(path, "utf8");
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (exemptLines.has(trimmed)) {
        seenExempt.add(trimmed);
        continue;
      }
      for (const needle of needles) {
        if (trimmed.includes(needle)) offenders.push(`${label}: ${needle}  ->  ${trimmed.slice(0, 90)}`);
      }
    }
  }
  // A stale exemption is a hole in the guard, so it fails rather than sitting there looking reassuring.
  const stale = [...exemptLines].filter((l) => !seenExempt.has(l));
  return offenders.concat(stale.map((l) => `STALE EXEMPTION (no longer in the source): ${l}`));
}

test("no component prints a raw concept or unit identifier", () => {
  const dir = join(import.meta.dirname, "components");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ path: join(dir, f), label: f }));
  const offenders = scanForRawIdentifiers(
    files,
    [
      "{u.title}",
      "{unit.title}",
      "{unit?.title ??",
      "{selected.title}",
      "{c.name}",
      "{row.concept}",
      "{mod.concept}",
      "s.concepts.join(",
      "concepts.join(",
    ],
    // `key={c.name}` is an identity, not display: React keys SHOULD be the raw id. It is handled by
    // shape rather than exemption because the needle `{c.name}` is a substring of `key={c.name}`.
    new Set(),
  ).filter((o) => !o.includes("key={c.name}") && !o.includes("key={u.name}"));
  assert.deepEqual(offenders, [], `these print an identifier instead of a display name:\n${offenders.join("\n")}`);
});

test("no module assembles a display string from a raw identifier", () => {
  // The model builds titles by concatenation, which is exactly where A1 hid. `${name}` is in the needle
  // list, and the two exemptions below are the only legitimate uses — both build machine-readable warning
  // CODES, which are matched on rather than read.
  const root = join(import.meta.dirname, "..", "..");
  const modelFiles = ["course-model.ts", "interactives.ts", "assessments.ts", "journal.ts", "server.ts"];
  const files = modelFiles.map((f) => ({ path: join(root, f), label: f }));
  const exempt = new Set([
    "duplicateConcept: (name: string) => `duplicate-concept:${name}`,",
    "unknownLesson: (name: string) => `unknown-lesson:${name}`,",
    "manifestDuplicate: (name: string) => `manifest-duplicate:${name}`,",
    "badParam: (name: string, reason: string) => `parameter-invalid:${name}:${reason}`,",
  ]);
  const offenders = scanForRawIdentifiers(
    files,
    ["${unit.title}", "${card.name}", "${c.name}", "${concepts}", "${name}", "${unit?.title}"],
    exempt,
  );
  assert.deepEqual(offenders, [], `these build display text from an identifier:\n${offenders.join("\n")}`);
});

test("every component that humanises actually imports the function", () => {
  // A missing import is how this fails silently in one file while the rest look right.
  const dir = join(import.meta.dirname, "components");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    if (source.includes("humanize(")) {
      assert.ok(
        source.includes('from "../humanize.ts"'),
        `${file} calls humanize but does not import it`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// B — a rename must not break the open lesson
// ---------------------------------------------------------------------------

test("an open lesson follows a rename exactly once", () => {
  const base = { from: "bicycle-wheel-truing", to: "wheel-building-and-truing", courseId: "bicycle-wheel-truing", busy: false, alreadyFollowed: null };
  assert.equal(shouldFollowRename(base), true, "the page holding the old id follows it");
  assert.equal(
    shouldFollowRename({ ...base, alreadyFollowed: "bicycle-wheel-truing->wheel-building-and-truing" }),
    false,
    "a re-delivered frame must not navigate a second time",
  );
});

test("a page holding a different course ignores the rename", () => {
  // Every open tab receives every frame; only the one on the renamed course may react.
  assert.equal(
    shouldFollowRename({ from: "a", to: "b", courseId: "c", busy: false, alreadyFollowed: null }),
    false,
  );
  // …and a malformed frame is not a rename at all.
  assert.equal(shouldFollowRename({ from: "", to: "b", courseId: "", busy: false, alreadyFollowed: null }), false);
  assert.equal(shouldFollowRename({ from: "a", to: "", courseId: "a", busy: false, alreadyFollowed: null }), false);
});

test("a turn in flight is not interrupted by a rename", () => {
  // Mid-turn the tutor is still writing, and it would be writing into a directory the page has left.
  assert.equal(
    shouldFollowRename({ from: "a", to: "b", courseId: "a", busy: true, alreadyFollowed: null }),
    false,
  );
});

test("a stale id reads as a sentence with a way back, never a raw server string", () => {
  // The observed failure: `unknown course: bicycle-wheel-truing-and-tensioning` on screen, no link.
  const view = courseErrorView("unknown course: bicycle-wheel-truing-and-tensioning");
  assert.equal(view.renamed, true);
  assert.ok(!view.detail.includes("unknown course:"), "the server's phrasing is not shown");
  assert.ok(view.detail.includes("bicycle-wheel-truing-and-tensioning"), "it names what is missing");
  assert.match(view.detail, /renamed/i, "and states the likely cause, which is a rename");
});

test("a non-rename failure is not blamed on a rename", () => {
  // Do not tell a learner their course moved when the server was simply down.
  const down = courseErrorView("could not reach the server");
  assert.equal(down.renamed, false);
  assert.equal(down.detail, "could not reach the server");
  const other = courseErrorView("HTTP 500");
  assert.equal(other.renamed, false);
  assert.equal(other.heading, "Course unavailable");
});

// The deferred-rename boundary, stated because it is real and was observed end to end:
//   a rename requested WHILE A TURN IS RUNNING is deferred by the server, and the lesson deliberately
//   does not follow it mid-turn — the tutor would be writing into a directory the page has left. So the
//   page keeps the old id until the learner does something. A reload recovers (verified: the stale id
//   showed no error at all, because the reconcile runs on read and the page then asked for a course that
//   exists). This test pins the rule that produces that behaviour so nobody "fixes" it into a mid-turn
//   navigation.
test("the follow rule is the only thing deciding a rename navigation", () => {
  assert.equal(
    shouldFollowRename({ from: "a", to: "b", courseId: "a", busy: false, alreadyFollowed: null }),
    true,
  );
  assert.equal(
    shouldFollowRename({ from: "a", to: "b", courseId: "a", busy: true, alreadyFollowed: null }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Step 2 — dispatch lifecycle: repeat clicks fire, refreshes keep intent
// ---------------------------------------------------------------------------

test("a module row carries the intent, not just the destination", () => {
  // A Recite or Explain row used to open the lesson with NOTHING dispatched, so the tutor sat silent until
  // the learner typed. The grill row already did this correctly.
  const recite = moduleAskHref("c", 3, "recite", "suspension-angle-vocabulary");
  const explain = moduleAskHref("c", 3, "explain", "suspension-angle-vocabulary");
  assert.ok(recite && recite.includes("ask="), "recite dispatches");
  assert.ok(explain && explain.includes("ask="), "explain dispatches");
  assert.ok(recite!.includes("/lesson/c/3"), "and still lands on the right unit");
  // the prompt carries a skill the tutor can actually load (see T-058) and the concept's display name
  assert.ok(decodeURIComponent(recite!).includes("/skill:grill-misconception"), "a served skill");
  assert.ok(decodeURIComponent(recite!).includes("Suspension Angle Vocabulary"), "the human name");
  // types with no dispatch contract keep the plain destination
  assert.equal(moduleAskHref("c", 3, "article", "x"), null);
});

test("the dispatch key distinguishes a repeat click from a re-render", () => {
  // The bug: `dispatched.current === ask` was never reset, so a second click on the same module was a
  // silent no-op. The generation is what makes the second arrival new.
  const key = (ask: string, arrival: number) => `${ask}#${arrival}`;
  assert.equal(key("grill X", 1), key("grill X", 1), "one arrival, one key — no double fire");
  assert.notEqual(key("grill X", 1), key("grill X", 2), "a second click is a new arrival");
});

test("the ask stays in the URL so a refresh keeps the intent", () => {
  // `replaceState` used to strip `?ask=` immediately, which lost it for a refresh and the back button.
  const href = moduleAskHref("c", 3, "recite", "tension");
  assert.ok(href!.includes("?ask="), "the intent is in the URL the learner can reload");
});

// ---------------------------------------------------------------------------
// Step 3c/6b — session records, and not leaking the machine
// ---------------------------------------------------------------------------

test("a session's misconception is shown with its own tense and the present one", () => {
  const row = {
    id: "MIS-001",
    concept: "tension",
    summary: "spokes carry load in compression",
    occurred: "open" as const,
    currentState: "resolved",
    sinceResolved: true,
  };
  const line = sessionMisconceptionLine(row);
  assert.equal(line.sinceResolved, true);
  assert.match(line.text, /^Open: /, "what the record said at the time");
  assert.match(line.text, /since resolved/, "and where it stands now");
});

test("a still-open belief says so rather than reading as fixed", () => {
  const line = sessionMisconceptionLine({
    id: "MIS-002",
    concept: "tension",
    summary: "s",
    occurred: "open",
    currentState: "open",
    sinceResolved: false,
  });
  assert.match(line.text, /still open/);
  assert.equal(line.sinceResolved, false);
});

test("absolute paths are neutralised in anything shown", () => {
  // GL-019: a session record carries the machine's paths, which leak the OS username.
  const shown = stripAbsolutePaths(
    "Transcript: C:\\Users\\Kasim Alam\\.socrates\\pi\\sessions\\--x--\\abc.jsonl and /home/kasim/x",
  );
  assert.ok(!shown.includes("Kasim"), `username leaked: ${shown}`);
  assert.ok(!shown.includes("C:\\"), "no drive path");
  assert.ok(!shown.includes("/home/"), "no POSIX home path");
  assert.ok(shown.includes("(this course)"), "and it still says something useful");
});

test("stripping paths leaves ordinary prose alone", () => {
  const prose = "You corrected the misconception about spoke tension — nice work.";
  assert.equal(stripAbsolutePaths(prose), prose);
});
