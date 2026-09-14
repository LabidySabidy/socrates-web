/**
 * signal.test.ts — T-057: the gap signal must tell "pipeline broken" from "nothing changed yet".
 *
 * Reproduced live: a grill that was still probing (correct behaviour, no verdict reached) logged
 * `telemetry_missing` on nine consecutive turns of one unit. Step 3 makes the tutor read those records, so
 * a false gap misinforms the recap it feeds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countUserPrompts,
  detectGrillTurn,
  detectRecordableGrillTurn,
  lastAssistantMessageText,
} from "./signal.ts";

const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (text: string) => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
const grillDispatch = (concept: string) =>
  user(`<skill name="grill-misconception" location="…">\n# Skill\n\n${concept}`);

test("a grill dispatch is still detected as a grill", () => {
  const entries = [grillDispatch("Tension")];
  assert.equal(detectGrillTurn(entries).active, true);
  assert.equal(detectGrillTurn(entries).evidence, "grill-misconception");
});

test("a probing turn owes no telemetry, so no gap is recorded", () => {
  // The observed case: the tutor asks a hard question and deliberately reveals nothing.
  const entries = [grillDispatch("Tension"), assistant("What happens to the bottom spokes when you sit on the bike? Commit to A, B or C before you read on.")];
  assert.equal(detectGrillTurn(entries).active, true, "it IS a grill turn");
  assert.equal(
    detectRecordableGrillTurn(entries, lastAssistantMessageText(entries)).active,
    false,
    "…but nothing changed, so there is no gap to record",
  );
});

test("a verdict with no telemetry IS a gap", () => {
  // The other direction matters as much: if the tutor named a state and no block arrived, the pipeline
  // really did break, and that must still be recorded.
  const entries = [grillDispatch("Tension"), assistant("That is wrong — you are still thinking of the spokes as pillars.")];
  const withBadge = [...entries.slice(0, 1), assistant("You are at 🟨 on this now.")];
  assert.equal(detectRecordableGrillTurn(withBadge, lastAssistantMessageText(withBadge)).active, true);
  // and the tool name counts as a verdict too
  const withTool = [...entries.slice(0, 1), assistant("Recording this with record_learning now.")];
  assert.equal(detectRecordableGrillTurn(withTool, lastAssistantMessageText(withTool)).active, true);
});

test("a verdict is read from the LAST assistant message, not the first", () => {
  const entries = [grillDispatch("X"), assistant("First question, no verdict."), assistant("You are 🟩 on this.")];
  assert.equal(lastAssistantMessageText(entries), "You are 🟩 on this.");
  assert.equal(detectRecordableGrillTurn(entries, lastAssistantMessageText(entries)).active, true);
});

test("a non-grill turn never records a gap, verdict or not", () => {
  const entries = [user("just chatting"), assistant("You are 🟩 on this.")];
  assert.equal(detectRecordableGrillTurn(entries, lastAssistantMessageText(entries)).active, false);
});

test("no assistant message at all is not a verdict", () => {
  const entries = [grillDispatch("X")];
  assert.equal(lastAssistantMessageText(entries), null);
  assert.equal(detectRecordableGrillTurn(entries, null).active, false);
});

test("user prompts are counted, not agent turns", () => {
  assert.equal(countUserPrompts([user("a"), assistant("b"), user("c")]), 2);
});
