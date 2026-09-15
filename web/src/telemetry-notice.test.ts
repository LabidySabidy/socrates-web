/**
 * The misconception notice — and the restraint that matters more than the notice.
 *
 * The owner asked for "misconception identified and added to the list" with the detail quoted. The risk in
 * implementing that literally is that it would fire on EVERY telemetry block, and 26 of 29 real events are
 * plain badge/SM-2 updates carrying no misconception. So most of these tests are about what is NOT shown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTelemetry, severityNote } from "./telemetry-notice.ts";
import { telemetryNotice } from "./telemetry-notice-parse.ts";

/** The exact block the owner's screenshot showed — a badge/sm2 update with NO misconception. */
const REAL_LEAKED_BLOCK = JSON.stringify({
  concept: "How A House Lighting Circuit Works",
  status: "🟥",
  sm2: { interval: 1, ease_factor: 1.96, repetitions: 0 },
});

/** A real recorded misconception, verbatim from the owner's event log. */
const REAL_MISCONCEPTION = JSON.stringify({
  concept: "suspension-angle-vocabulary",
  status: "🟥",
  sm2: { interval: 1, ease_factor: 1.96, repetitions: 0 },
  misconception: {
    id: "MIS-001",
    description:
      "Caster is 'how far forward or back the wheel is from KPI' and a larger KPI pushes the wheel centre fore/aft; front-view axis tilt explained as a fore/aft position.",
    status: "open",
    severity: "root",
  },
});

test("the block from the owner's screenshot produces NO notice", () => {
  // This is the important one. That block was a badge update; a notice here would tell the learner a
  // misconception was recorded when none was.
  assert.equal(telemetryNotice(REAL_LEAKED_BLOCK), null);
});

test("a plain badge change produces NO notice — the rail already shows it", () => {
  assert.equal(telemetryNotice(JSON.stringify({ concept: "x", status: "🟩" })), null);
  assert.equal(telemetryNotice(JSON.stringify({ concept: "x", status: "🟨", sm2: { interval: 3, ease_factor: 2.5, repetitions: 2 } })), null);
});

test("a real recorded misconception produces a notice quoting the learner's belief", () => {
  const n = telemetryNotice(REAL_MISCONCEPTION);
  assert.ok(n, "a misconception must be surfaced");
  assert.equal(n.kind, "misconception-open");
  assert.equal(n.title, "Misconception identified");
  assert.equal(n.id, "MIS-001");
  assert.equal(n.severity, "root");
  assert.match(n.description, /Caster is 'how far forward or back/, "the description is quoted, not paraphrased");
  assert.match(n.concept, /suspension-angle-vocabulary/);
});

test("a RESOLVED misconception reads differently from an opened one", () => {
  // Telling a learner "identified" for something they just fixed would be worse than saying nothing.
  const resolved = telemetryNotice(
    JSON.stringify({
      concept: "x",
      status: "🟩",
      misconception: { id: "MIS-002", description: "thought camber was toe", status: "resolved" },
    }),
  );
  assert.ok(resolved);
  assert.equal(resolved.kind, "misconception-resolved");
  assert.equal(resolved.title, "Misconception resolved");
});

test("a misconception with an EMPTY description produces no notice", () => {
  // Nothing to quote means an empty box — the same silent-failure family the telemetry leak came from.
  assert.equal(telemetryNotice(JSON.stringify({ concept: "x", misconception: { id: "M", description: "  " } })), null);
  assert.equal(telemetryNotice(JSON.stringify({ concept: "x", misconception: { description: "" } })), null);
});

test("unparseable or non-telemetry content is not shown as a notice", () => {
  assert.equal(telemetryNotice("not json at all"), null);
  assert.equal(telemetryNotice(""), null);
  assert.equal(telemetryNotice("{}"), null);
  assert.equal(telemetryNotice("[1,2,3]"), null);
});

test("the model's code-fenced JSON is still understood", () => {
  // The tutor sometimes wraps the block in fences; the parser tolerates that rather than dropping a real
  // misconception because of formatting.
  const fenced = "```json\n" + REAL_MISCONCEPTION + "\n```";
  const n = telemetryNotice(fenced);
  assert.ok(n);
  assert.equal(n.id, "MIS-001");
});

test("trailing commas from the model do not cost the learner the notice", () => {
  const sloppy = '{"concept":"x","misconception":{"id":"M","description":"a belief",},}';
  assert.ok(telemetryNotice(sloppy));
});

test("severity is described in plain words, and an unknown severity says nothing", () => {
  assert.match(severityNote("root") ?? "", /idea underneath/);
  assert.match(severityNote("partial") ?? "", /partly/);
  assert.match(severityNote("edge") ?? "", /edges/);
  assert.equal(severityNote("mystery"), null);
  assert.equal(severityNote(undefined), null);
});

test("classifyTelemetry rejects non-objects without throwing", () => {
  for (const v of [null, undefined, 0, "str", true]) assert.equal(classifyTelemetry(v), null);
});

test("readLearningNotice accepts a well-formed notice and rejects the rest", async () => {
  const { readLearningNotice } = await import("./telemetry-notice.ts");
  const good = { type: "learning-notice", notice: { kind: "misconception-open", title: "Misconception identified", concept: "x", description: "a belief" } };
  assert.ok(readLearningNotice(good), "a real notice is read");
  // Every rejection below is a shape that would render an empty or broken box.
  assert.equal(readLearningNotice({ type: "learning-notice" }), null);
  assert.equal(readLearningNotice({ type: "learning-notice", notice: { kind: "wrong" } }), null);
  assert.equal(readLearningNotice({ type: "learning-notice", notice: { kind: "misconception-open", title: "t", description: "   " } }), null);
  assert.equal(readLearningNotice({ type: "message_update" }), null);
  assert.equal(readLearningNotice(null), null);
});
