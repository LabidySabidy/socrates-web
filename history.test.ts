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
  // `thinking` is NOT carried. The fixture has a thinking block, and the restored turn deliberately omits it:
  // reasoning is back-end working and is never rendered (owner, 2026-09-15).
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
  // conversation, so its TEXT must never be restored as the learner's speech — that is the C2 defect, where the
  // learner read a slash command and scripted first-person words they never wrote.
  //
  // THIS TEST USED TO ASSERT `turns === []`, and D13/D14 changed that deliberately. Dropping the turn entirely
  // also dropped the TUTOR'S REPLY to it, which is the whole reason reports #13 and #14 exist: "opening back
  // into a topic i had already started doesnt include the lessons before the question". The turn now restores
  // with `origin: "app"` and EMPTY text, so the reply survives and the dispatch is still never shown.
  const turns = parseHistory(
    [
      entry("user", text('<skill name="scaffold-learning" location="...">\n# Skill: Scaffold Learning')),
      entry("assistant", text("What do you want to be able to do?")),
    ].join("\n"),
  );
  assert.equal(turns.length, 2, "the tutor's opening restores");
  assert.equal(turns[0].origin, "app", "marked as the app's own turn, not the learner's");
  assert.equal(turns[0].text, "", "and carrying none of the dispatch text");
  assert.equal(turns[1].text, "What do you want to be able to do?", "the tutor's question survives");
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

// ---------------------------------------------------------------------------
// D1 + D13 + D14 — the FULL conversation must be restored
//
// Reports: #1 `…6a31d780` "rendered the past conversation … THIS NEEDS TO BE THE NORM", #13 `…d7dfdcd2`
// "doesnt include the lessons before the question", #14 `…e9c8d721` "doesnt guaruntee the previous explainer
// teachings are re-displayed above the question being posed". Owner's decision: "I want to see the full
// history."
// ---------------------------------------------------------------------------

test("a long conversation is returned WHOLE, with no silent truncation", () => {
  // The old reader took a tail of 40 and set `truncated`. The owner wants the full history, and a `truncated`
  // flag that nobody renders is the same silent-loss defect this work is fixing elsewhere.
  const lines: string[] = [];
  for (let i = 0; i < 60; i++) {
    lines.push(JSON.stringify({ type: "message", message: { role: "user", content: `q${i}` } }));
    lines.push(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: `a${i}` }] } }));
  }
  const turns = parseHistory(lines.join("\n"));
  assert.equal(turns.length, 120, `all 60 exchanges come back, got ${turns.length}`);
  assert.equal(turns[0].text, "q0", "the FIRST turn is present, not just the recent ones");
  assert.equal(turns[turns.length - 1].text, "a59");
});

test("restored turns do NOT carry reasoning — it is never rendered", () => {
  // REVERSES the earlier D6 fix, deliberately. That fix made restored turns carry `thinking` so the "View
  // Socratic Reasoning" drawer had something to show. The owner has since removed the drawer:
  // "the views are credit reasoning doesn't provide any value to the user, nor do other back end messages."
  //
  // The reasoning is still WRITTEN to the session file (owner: "It's useful for debugging"). This reader stops
  // carrying it, so nothing downstream can render it — and the D6 (b) half, the opening turn firing after a
  // mid-turn exit, is unaffected and pinned separately in ui.test.ts.
  const turns = parseHistory(
    [
      entry("user", text("is camber the same as toe?")),
      entry("assistant", [
        { type: "thinking", thinking: "The learner conflates camber with toe, so I should probe the view." },
        { type: "text", text: "Which view is camber read in?" },
      ]),
    ].join(String.fromCharCode(10)),
  );
  assert.equal(turns.length, 2);
  const assistant = turns[1] as { text: string; thinking?: string };
  assert.match(assistant.text, /Which view is camber read in/, "the prose still restores");
  assert.equal(assistant.thinking, undefined, "and the reasoning does not come with it");
});

// ---------------------------------------------------------------------------
// The live record — a running session has no SESSIONS/*.md yet
//
// Measured: reloading ~1s into a long turn rendered 1 block / 143 chars (the lesson intro) while 22 blocks of
// conversation existed. SESSIONS/*.md is written at session END, so a running turn has no record to restore
// from. The pi JSONL is appended CONTINUOUSLY, so the restore reads it for the session still in progress.
// ---------------------------------------------------------------------------

test("a TRUNCATED final line is tolerated — now load-bearing, not incidental", () => {
  // A hard kill mid-write leaves a half-line. Reading the LIVE file means this case happens in normal use, so
  // it is pinned rather than left to a comment.
  const truncated =
    [
      entry("user", text("q1")),
      entry("assistant", text("a1")),
      entry("user", text("q2")),
      '{"type":"message","id":"abc","message":{"role":"assist',
    ].join(String.fromCharCode(10)) + String.fromCharCode(10);
  const turns = parseHistory(truncated);
  assert.equal(turns.length, 2, "the complete turns survive");
  assert.equal(turns[1].text, "a1");
  // And the half-written turn is DROPPED rather than shown as a finished reply.
  assert.ok(!turns.some((t) => t.text.includes("assist")), "no fragment of the partial line is rendered");
});

test("a file ending mid-STRING inside an assistant reply recovers the settled turns", () => {
  // The realistic interruption: the model was streaming when the process died.
  const partial = '{"type":"message","id":"z","message":{"role":"assistant","content":[{"type":"text","text":"I was say';
  const turns = parseHistory([entry("user", text("q")), entry("assistant", text("done")), partial].join(String.fromCharCode(10)));
  assert.equal(turns.length, 2);
  assert.equal(turns[1].text, "done", "the finished reply is what the learner sees");
});
