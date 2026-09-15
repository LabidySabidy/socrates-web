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
  // `thinking` is now carried alongside the prose (D6). This fixture HAS a thinking block, so the turn
  // restores with it — the drawer needs it, and it never appears in the conversation.
  assert.deepEqual(turns, [
    { role: "user", text: "what is camber?" },
    { role: "assistant", text: "Camber is the wheels lean.", thinking: "they asked about camber" },
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

test("restored turns carry their REASONING, so the drawer has something to show", () => {
  // D6 (report #6, `…539bec85`): "no reasoning recorded this turn when I clicked out of the lesson and then
  // back into it". The reader dropped thinking blocks, so a restored turn had none while a live one did.
  //
  // A turn is a USER entry followed by an assistant entry; an assistant entry alone is not a settled turn and
  // is dropped by design, so the fixture includes the prompt.
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
  assert.match(assistant.text, /Which view is camber read in/);
  assert.match(assistant.thinking ?? "", /conflates camber with toe/, "the reasoning is carried alongside the prose");
});

test("a turn with NO reasoning restores honestly, rather than inventing one", () => {
  const turns = parseHistory(
    [entry("user", text("ok?")), entry("assistant", text("yes"))].join(String.fromCharCode(10)),
  );
  assert.equal(turns.length, 2);
  assert.equal((turns[1] as { thinking?: string }).thinking, undefined, "absent stays absent, not an empty string");
});

test("D13/D14 — a turn the APP opened (skill dispatch) still restores, with its reply", () => {
  // The measured cause of reports #13 and #14. The first user message in a tutor-opened lesson IS the skill
  // dispatch, and it was filtered out of `pending` — so the tutor's reply to it had no turn to settle into and
  // was DROPPED. On the real course the session's only user message is `<skill name="grill-misconception" …>`
  // followed by a real assistant reply, and `parseHistory` returned zero turns for it.
  //
  // Reports: #13 `…d7dfdcd2` "opening back into a topic i had already started doesnt include the lessons before
  // the question", #14 `…e9c8d721` "jumping back into an old session doesnt guaruntee the previous explainer
  // teachings are re-displayed above the question being posed".
  const turns = parseHistory(
    [
      entry("user", text('<skill name="grill-misconception" location="somewhere">')),
      entry("assistant", text("I'll pull your state first.")),
      entry("assistant", text("Here is what camber is, and why it matters.")),
    ].join(String.fromCharCode(10)),
  );
  assert.equal(turns.length, 2, `the tutor's opening must restore, got ${JSON.stringify(turns)}`);
  assert.equal(turns[0].role, "user");
  assert.match(turns[1].text, /Here is what camber is/);
});

test("D13/D14 — a skill dispatch is never shown as the learner's own words", () => {
  // The other half, and the reason the filter exists: rendering the dispatch would show the learner a slash
  // command and scripted first-person text they never wrote (the C2 defect).
  const turns = parseHistory(
    [entry("user", text('<skill name="grill-misconception">teach me')), entry("assistant", text("ok"))].join(String.fromCharCode(10)),
  );
  for (const t of turns) {
    assert.ok(!t.text.includes("<skill"), `the dispatch must not appear: ${t.text}`);
    assert.ok(!t.text.includes("grill-misconception"), `nor its name: ${t.text}`);
  }
});
