/**
 * The learner must never see a telemetry block.
 *
 * THE DEFECT. The extension cleans the assistant message on `message_end`, and pi applies that replacement
 * (`agent-session.js:427`) — but `message_end` fires AFTER generation, while `text_delta` events stream to the
 * browser DURING it. `server.ts` forwards every line verbatim, so the tag reaches the screen and is cleaned too
 * late to matter. The session file looks clean, which is why inspecting stored data never revealed this.
 *
 * THE HARD PART, measured before writing this: the tag can arrive split across deltas. A per-delta `replace`
 * strips nothing in 3 of 4 split cases (`["text <learning-tele", "metry>{…}</learning-telemetry>"]`), so the
 * stripper must buffer across deltas. A per-delta regex would pass a simple test and still leak in production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelemetryStripper } from "./stream-clean.ts";

test("a tag in one delta is removed", () => {
  const strip = createTelemetryStripper();
  const out = strip('Here is the answer.\n<learning-telemetry>{"concept":"X"}</learning-telemetry>');
  assert.equal(out, "Here is the answer.\n");
});

test("a tag SPLIT ACROSS DELTAS is removed — the case a per-delta regex fails", () => {
  const strip = createTelemetryStripper();
  const a = strip("Here is the answer. <learning-tele");
  const b = strip('metry>{"concept":"X"}</learning-telemetry>');
  assert.ok(!(a + b).includes("learning-telemetry"), `leaked: ${JSON.stringify(a + b)}`);
  assert.ok((a + b).includes("Here is the answer."), "and the real prose survives");
});

test("a tag split anywhere — opening, body and closing — is removed", () => {
  const strip = createTelemetryStripper();
  let out = "";
  for (const d of ["x<learn", 'ing-telemetry>{"a":1}</lear', "ning-telemetry>y"]) out += strip(d);
  assert.equal(out, "xy", `expected the tag gone and both sentinels kept, got ${JSON.stringify(out)}`);
});

test("text after a closed tag is NOT held back", () => {
  // The buffer must only hold a PARTIAL tag. Holding ordinary text would delay the tutor's words, which is
  // the responsiveness the owner asked for.
  const strip = createTelemetryStripper();
  assert.equal(strip("plain text with no tag"), "plain text with no tag");
  assert.equal(strip("more plain text"), "more plain text");
});

test("a partial '<' at the end of a delta is held, then released when it turns out not to be a tag", () => {
  const strip = createTelemetryStripper();
  const held = strip("a comparison: 3 <");
  const rest = strip(" 5 is true");
  assert.equal(held + rest, "a comparison: 3 < 5 is true", "ordinary '<' must not be swallowed");
});

test("flush() releases anything still buffered at the end of a turn", () => {
  // If a turn ends mid-tag (the model was cut off), the buffer must not eat the rest of the reply.
  const strip = createTelemetryStripper();
  strip("answer <learning-tele");
  assert.equal(strip.flush(), "<learning-tele", "an unterminated partial is released, not lost");
});

test("two tags in one delta are both removed", () => {
  const strip = createTelemetryStripper();
  const out = strip('<learning-telemetry>{"a":1}</learning-telemetry>mid<learning-telemetry>{"b":2}</learning-telemetry>');
  assert.equal(out, "mid");
});

test("a tag spanning MANY deltas is removed", () => {
  const strip = createTelemetryStripper();
  const full = '<learning-telemetry>{"concept":"a very long concept name","status":"RED"}</learning-telemetry>';
  let out = "";
  for (const ch of full) out += strip(ch);
  assert.equal(out, "", `per-character streaming must still strip fully, got ${JSON.stringify(out)}`);
});
