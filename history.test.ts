/**
 * history.test.ts — Step 1e: restoring a settled transcript.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHistory, tailLines } from "./history.ts";

/** One pi session entry. */
const entry = (role: string, content: unknown) =>
  JSON.stringify({ type: "message", message: { role, content } });
const text = (t: string) => [{ type: "text", text: t }];

test("a settled exchange restores as a learner turn and a tutor turn", () => {
  const turns = parseHistory(
    [
      entry("user", text("what is camber?")),
      entry("assistant", [{ type: "thinking", thinking: "they asked about camber" }, ...text("Camber is the wheels lean.")]),
    ].join("\n"),
  );
  assert.deepEqual(turns, [
    { role: "user", text: "what is camber?" },
    { role: "assistant", text: "Camber is the wheels lean." },
  ]);
});

test("thinking and tool calls are not restored as prose", () => {
  // The bug this pins: rendering the raw scratchpad. Only `text` parts are what the learner read.
  const turns = parseHistory(
    [
      entry("user", text("hi")),
      entry("assistant", [
        { type: "thinking", thinking: "Let me start by loading context per the memory protocol." },
        { type: "toolCall", name: "read", arguments: {} },
        { type: "text", text: "Hello — where would you like to start?" },
      ]),
    ].join("\n"),
  );
  assert.equal(turns.length, 2);
  assert.equal(turns[1].text, "Hello — where would you like to start?");
  assert.ok(!turns[1].text.includes("memory protocol"), "no scratchpad");
});

test("a tool-heavy turn restores the LAST prose, which is what the learner read", () => {
  const turns = parseHistory(
    [
      entry("user", text("review my wheel")),
      entry("assistant", [{ type: "toolCall", name: "read" }, { type: "text", text: "Let me look." }]),
      entry("toolResult", text("...file contents...")),
      entry("assistant", [{ type: "text", text: "Your tension is uneven on the drive side." }]),
    ].join("\n"),
  );
  assert.equal(turns[1].text, "Your tension is uneven on the drive side.");
});

test("a partial turn is dropped, never shown as complete", () => {
  // The page closed mid-turn: the learner's message is there, the reply never arrived.
  const turns = parseHistory(
    [entry("user", text("hello?")), entry("assistant", [{ type: "thinking", thinking: "still working" }])].join("\n"),
  );
  assert.deepEqual(turns, [], "a turn with no prose did not settle, so it is not restored");
});

test("a turn waiting on a tool result is dropped rather than half-shown", () => {
  const turns = parseHistory(
    [
      entry("user", text("older question")),
      entry("assistant", text("an older, complete answer")),
      entry("user", text("new question")),
      entry("assistant", [{ type: "toolCall", name: "read", arguments: {} }]),
      entry("toolResult", text("result arrived, but no prose followed")),
    ].join("\n"),
  );
  assert.deepEqual(
    turns.map((t) => t.text),
    ["older question", "an older, complete answer"],
    "the unfinished exchange is left out; the finished one is kept",
  );
});

test("a skill dispatch is not restored as the learner's own words", () => {
  // `/skill:scaffold-learning` is the app talking to the tutor. It is shown live (T-050) but is not
  // conversation, so a restored transcript does not open with it.
  const turns = parseHistory(
    [
      entry("user", text('<skill name="scaffold-learning" location="...">\n# Skill: Scaffold Learning')),
      entry("assistant", text("What do you want to be able to do?")),
    ].join("\n"),
  );
  assert.deepEqual(turns, [], "the dispatch had no learner words in it");
});

test("a course with no history restores nothing, and that is not an error", () => {
  assert.deepEqual(parseHistory(""), []);
  assert.deepEqual(parseHistory("\n\n"), []);
  // A session killed mid-write leaves a truncated final line.
  const partial = [entry("user", text("q")), entry("assistant", text("a")), '{"type":"message","mess'].join("\n");
  assert.deepEqual(parseHistory(partial).map((t) => t.text), ["q", "a"]);
});

test("only the tail of a long session is read", () => {
  const many = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n");
  const tail = tailLines(many, 10).split("\n");
  assert.equal(tail.length, 10);
  assert.equal(tail[0], "line-90");
  // a short session is returned whole
  assert.equal(tailLines("a\nb", 10), "a\nb");
});
