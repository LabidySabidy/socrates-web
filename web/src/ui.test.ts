/**
 * ui.test.ts — client-side logic that must not drift, tested without a browser.
 *
 * The server sends the STATE (severity, mastery); the client owns the COLOURS. These tests guard
 * the presentation mapping and the pure list logic, so a change is caught here rather than by
 * eyeballing a screenshot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeCount, trayRows } from "./misconceptions.ts";
import { SEVERITY_COLOR, SEVERITY_LABEL, MASTERY_STATES, mastery } from "./severity.ts";
import { memoryStrength } from "./memory.ts";
import {
  catalogueCourses,
  filterCourses,
  mostRecent,
  totalMasteryCounts,
  uninitiatedCourses,
} from "./select.ts";
import { ALL_MODULE_TYPES, MODULE_LABELS, MODULE_PATHS, moduleTypeLabel } from "./module-types.ts";
import { emptyTurn, isSilent, reduceTurn, splitTurn } from "./turn.ts";
import { courseScrollKey, readPaneScroll, savePaneScroll } from "./scroll.ts";
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
    hidden: false,
    order: null,
    concepts: 0,
    masteryCounts: {},
    sessions: { count: 0, lastAt: null },
    initiated: true,
    kind: "topic",
    fromScan: true,
    fromRegistry: false,
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
// discovery is intentional: a course must be initiated
// ---------------------------------------------------------------------------

test("only initiated, unhidden courses reach the catalogue and its count", () => {
  const courses = [
    course({ id: "real", label: "Real" }),
    course({ id: "bare", label: "Bare", initiated: false }),
    course({ id: "hidden", label: "Hidden", hidden: true }),
  ];

  assert.deepEqual(catalogueCourses(courses).map((c) => c.id), ["real"]);
  assert.deepEqual(uninitiatedCourses(courses).map((c) => c.id), ["bare"]);

  assert.equal(
    catalogueCourses(courses).length,
    1,
    "the count next to the course list is the catalogue count, not the scan count",
  );
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
