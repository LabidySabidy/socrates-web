/**
 * Does the app feel alive while the tutor is silent?
 *
 * The owner's requirement, in their words: "the app needs to feel alive and responsive", and latency between
 * actions must not be long. The failure this guards is specific — during a provider outage the tutor emits
 * nothing, so the app must still tell the learner what is happening.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeWait, liveness, DEAD_AFTER_MS, STALLED_AFTER_MS } from "./liveness.ts";

test("a turn that just started is working, not stalled", () => {
  assert.equal(liveness({ elapsedMs: 200, sinceOutputMs: 200 }), "working");
});

test("a turn streaming steadily is WORKING however long it runs", () => {
  // The distinction that matters: a long legitimate turn must never be called stalled. Liveness is driven by
  // time since OUTPUT, not time since the turn began.
  assert.equal(liveness({ elapsedMs: 240_000, sinceOutputMs: 300 }), "working");
  assert.equal(liveness({ elapsedMs: 600_000, sinceOutputMs: 1_000 }), "working");
});

test("a silent turn becomes stalled", () => {
  assert.equal(liveness({ elapsedMs: 50_000, sinceOutputMs: 50_000 }), "stalled");
});

test("the stalled boundary is the silence threshold, not the elapsed time", () => {
  assert.equal(liveness({ elapsedMs: STALLED_AFTER_MS - 1, sinceOutputMs: STALLED_AFTER_MS - 1 }), "working");
  assert.equal(liveness({ elapsedMs: STALLED_AFTER_MS, sinceOutputMs: STALLED_AFTER_MS }), "stalled");
});

test("a retry in flight is never described as working", () => {
  // Saying "working" while the provider is refusing would hide the exact condition the learner needs.
  assert.equal(liveness({ elapsedMs: 3_000, sinceOutputMs: 3_000, retrying: true }), "quiet");
  assert.equal(liveness({ elapsedMs: 60_000, sinceOutputMs: 60_000, retrying: true }), "stalled");
});

test("elapsed time is visible from the first second, so a stall is legible early", () => {
  assert.match(describeWait({ elapsedMs: 0, sinceOutputMs: 0 }), /thinking/);
  assert.match(describeWait({ elapsedMs: 20_000, sinceOutputMs: 20_000 }), /20s/, "the clock is on screen");
});

test("a stalled turn says the service may be down AND offers a way out", () => {
  const msg = describeWait({ elapsedMs: 150_000, sinceOutputMs: 150_000 });
  assert.match(msg, /150s/);
  assert.match(msg, /down|unavailable|struggling/i, "it names the plausible cause");
  assert.match(msg, /wait|try again|stop/i, "and gives the learner a choice rather than only patience");
});

test("NO wait message claims the turn failed", () => {
  // A turn that is still running must not be reported as failed. Telling a learner it failed and then
  // delivering a reply is worse than telling them it is slow.
  const cases = [
    { elapsedMs: 0, sinceOutputMs: 0 },
    { elapsedMs: 60_000, sinceOutputMs: 60_000 },
    { elapsedMs: 179_000, sinceOutputMs: 179_000 },
    { elapsedMs: 60_000, sinceOutputMs: 60_000, retrying: true },
  ];
  for (const c of cases) {
    const msg = describeWait(c);
    assert.ok(!/\bfailed\b|\berror\b|\bbroken\b/i.test(msg), `must not claim failure while running: "${msg}"`);
  }
});

test("a retrying turn names the retry rather than showing an idle spinner", () => {
  assert.match(describeWait({ elapsedMs: 8_000, sinceOutputMs: 8_000, retrying: true }), /retry/i);
});

test("the dead threshold is inside the 180s ceiling, so it is a warning before the end", () => {
  // Ordering matters: the learner must be warned (STALLED, DEAD) before the turn gives up at 180s. If the
  // thresholds crossed 180s, every warning would arrive after the failure and cover nothing.
  assert.ok(STALLED_AFTER_MS < DEAD_AFTER_MS, "stalled is reached before dead");
  assert.ok(DEAD_AFTER_MS < 180_000, `the dead warning (${DEAD_AFTER_MS}ms) must precede the 180s ceiling`);
});
