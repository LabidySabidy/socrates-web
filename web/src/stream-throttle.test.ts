/**
 * The batcher that stops a long turn freezing the tab.
 *
 * The contract that matters: batching must not change the TEXT. If the batched result differs from folding
 * every delta in order, the reply is corrupted — which is worse than the freeze being fixed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeltaBatcher, FLUSH_INTERVAL_MS } from "./stream-throttle.ts";

test("draining returns everything pushed, in order", () => {
  const b = createDeltaBatcher();
  b.push("Hello ");
  b.push("world");
  assert.equal(b.drain(), "Hello world");
});

test("a SECOND drain returns empty — the buffer is cleared, not replayed", () => {
  // Replaying would duplicate text, which is the failure mode of a naive `join` on a growing array.
  const b = createDeltaBatcher();
  b.push("once");
  assert.equal(b.drain(), "once");
  assert.equal(b.drain(), "", "nothing is re-emitted");
  assert.equal(b.drain(), "");
});

test("pending() reports what is queued WITHOUT clearing it", () => {
  const b = createDeltaBatcher();
  b.push("abc");
  assert.equal(b.pending(), "abc");
  assert.equal(b.pending(), "abc", "peeking must not consume");
  assert.equal(b.drain(), "abc");
});

test("BATCHED OUTPUT IS IDENTICAL to folding every delta one at a time", () => {
  // THE test. The whole justification for batching is that it is invisible in the result. A synthetic turn of
  // the size that froze the tab: 6,442 deltas.
  const deltas: string[] = [];
  for (let i = 0; i < 6442; i++) deltas.push(i % 7 === 0 ? " " : String.fromCharCode(97 + (i % 26)));

  const unbatched = deltas.join("");

  const b = createDeltaBatcher();
  let batched = "";
  let flushes = 0;
  for (const d of deltas) {
    b.push(d);
    // Flush every 20th delta, standing in for a frame tick.
    if (++flushes % 20 === 0) batched += b.drain();
  }
  batched += b.drain();

  assert.equal(batched, unbatched, "batching must be invisible in the text");
  assert.equal(batched.length, unbatched.length);
});

test("a flush every N deltas yields about N-times fewer updates", () => {
  // The point of the exercise. 6,442 updates is what locked the browser.
  const total = 6442;
  const every = 20;
  let updates = 0;
  const b = createDeltaBatcher();
  for (let i = 0; i < total; i++) {
    b.push("x");
    if ((i + 1) % every === 0) {
      b.drain();
      updates++;
    }
  }
  b.drain();
  assert.ok(updates <= Math.ceil(total / every) + 1, `updates collapsed: ${updates}`);
  assert.ok(updates < total / 10, `an order of magnitude fewer: ${updates} vs ${total}`);
});

test("an empty push, or pushing nothing at all, is harmless", () => {
  const b = createDeltaBatcher();
  assert.equal(b.drain(), "");
  b.push("");
  assert.equal(b.drain(), "");
});

test("the flush interval is slow enough to collapse a burst, fast enough to look live", () => {
  // 50ms: ~20 updates/second. Below ~100ms reads as typing; above ~250ms reads as chunking.
  assert.ok(FLUSH_INTERVAL_MS >= 16, "not faster than a frame, or batching buys nothing");
  assert.ok(FLUSH_INTERVAL_MS <= 100, "not so slow the text arrives in lumps");
});
