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
import { filterCourses, mostRecent, totalMasteryCounts } from "./select.ts";
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
