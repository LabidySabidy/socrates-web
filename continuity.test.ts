/**
 * continuity.test.ts — Steps 3a/3b/3e: what is TRUE NOW versus what HAPPENED THEN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContinuity, lessonMode } from "./continuity.ts";
import type { LearningData, Misconception } from "./learning-parser.ts";
import type { SessionSummary } from "./journal.ts";

const card = (name: string, badge: string, repetitions = 0) => ({
  name,
  badge: badge as LearningData["schema"]["concepts"][number]["badge"],
  label: "label",
  sm2: { last_tested: "—", next_review: "—", interval: repetitions > 0 ? 3 : 0, ease_factor: 2.5, repetitions },
  due: "upcoming" as const,
});

const registry = (rows: Partial<Misconception>[]): Map<string, Misconception> =>
  new Map(
    rows.map((r) => [
      r.id as string,
      {
        id: r.id as string,
        concept: r.concept as string,
        misconception: r.misconception ?? "",
        corrected: r.corrected ?? "",
        status: (r.status ?? "open") as Misconception["status"],
        date: r.date ?? "2026-09-14",
        severity: "",
      },
    ]),
  );

const session = (file: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  file,
  startedAt: "2026-09-14T00:00:00.000Z",
  endedAt: null,
  open: false,
  turns: 4,
  concepts: ["tension"],
  misconceptionRows: [],
  misconceptions: 0,
  gaps: 0,
  transcript: null,
  bytes: 100,
  ...over,
});

const learning = (concepts: ReturnType<typeof card>[]): LearningData =>
  ({ schema: { concepts } } as unknown as LearningData);

test("a misconception opened early reads as since-resolved when a later session fixed it", () => {
  // THE owner requirement: the record is a moment, the card is the truth, and opening the old session must
  // not claim the learner still holds a belief they have since put right.
  const now = registry([{ id: "MIS-001", concept: "tension", status: "resolved" }]);
  const view = buildContinuity(
    learning([card("tension", "🟨", 1)]),
    [
      session("old.md", {
        startedAt: "2026-09-01T00:00:00.000Z",
        misconceptionRows: [{ id: "MIS-001", concept: "tension", claimed: "open", summary: "spokes carry load in compression" }],
      }),
      session("new.md", {
        startedAt: "2026-09-10T00:00:00.000Z",
        misconceptionRows: [{ id: "MIS-001", concept: "tension", claimed: "resolved", summary: "spokes carry load in compression" }],
      }),
    ],
    now,
  );
  const old = view.sessions.find((s) => s.file === "old.md")!;
  assert.equal(old.misconceptions[0].occurred, "open", "the record's own tense is kept");
  assert.equal(old.misconceptions[0].currentState, "resolved", "…and the present tense is reported");
  assert.equal(old.misconceptions[0].sinceResolved, true, "which is what makes it read as fixed");

  const recent = view.sessions.find((s) => s.file === "new.md")!;
  assert.equal(recent.misconceptions[0].sinceResolved, false, "a resolution is not itself 'since resolved'");
});

test("a still-open misconception is not claimed as resolved", () => {
  const view = buildContinuity(
    learning([card("tension", "🟥", 1)]),
    [session("a.md", { misconceptionRows: [{ id: "MIS-001", concept: "tension", claimed: "open", summary: "s" }] })],
    registry([{ id: "MIS-001", concept: "tension", status: "open" }]),
  );
  const row = view.sessions[0].misconceptions[0];
  assert.equal(row.sinceResolved, false);
  assert.equal(row.currentState, "open");
});

test("a belief the registry no longer knows is reported as unknown, not assumed open", () => {
  const view = buildContinuity(
    learning([card("tension", "🟥", 1)]),
    [session("a.md", { misconceptionRows: [{ id: "MIS-999", concept: "tension", claimed: "open", summary: "s" }] })],
    registry([]),
  );
  assert.equal(view.sessions[0].misconceptions[0].currentState, "unknown");
  assert.equal(view.sessions[0].misconceptions[0].sinceResolved, false);
});

test("a concept's standing reflects badge and telemetry, and a fresh card is new", () => {
  const view = buildContinuity(
    learning([card("fresh", "⬜", 0), card("worked", "🟨", 2)]),
    [],
    registry([]),
  );
  const fresh = view.concepts.find((c) => c.concept === "fresh")!;
  const worked = view.concepts.find((c) => c.concept === "worked")!;
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.touched, false);
  assert.equal(worked.isNew, false);
  assert.equal(worked.touched, true);
});

// ---------------------------------------------------------------------------
// Step 4d's routing, decided by state rather than the model's mood
// ---------------------------------------------------------------------------

test("routing: new concept teaches, returning recaps, an explicit ask grills", () => {
  const neutral = { concept: "x", mastery: "Not started", isNew: true, touched: false, openMisconceptions: [], resolvedMisconceptions: [] };
  const worked = { ...neutral, isNew: false, touched: true, mastery: "Weak" };

  assert.equal(lessonMode({ asked: false, standing: neutral, hasHistory: false }), "teach", "new concept");
  assert.equal(lessonMode({ asked: false, standing: worked, hasHistory: true }), "recap-then-probe", "returning");
  assert.equal(lessonMode({ asked: true, standing: worked, hasHistory: true }), "grill", "explicit ask wins");
  // no card at all is as new as new gets
  assert.equal(lessonMode({ asked: false, standing: null, hasHistory: false }), "teach");
});
