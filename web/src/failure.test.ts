/**
 * The copy a learner reads when the tutor fails, and the wait they read while it works.
 *
 * These are the assertions that keep a multi-hour provider outage from reading as "the app is broken".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { failureView, waitingNotice } from "./failure.ts";

const REAL_OUTAGE = "We were unable to start processing your request within the 900-second timeout limit. Please try again later.";

test("a real timeout says nothing was lost and offers a retry", () => {
  const v = failureView(REAL_OUTAGE);
  assert.equal(v.retryable, true);
  assert.match(v.body, /not lost|nothing/i, "the learner must be told their work survived");
  assert.ok(v.action.length > 0, "a retryable failure offers an action");
});

test("NO provider text leaks into the copy", () => {
  // The raw string is for the bug report. A learner reading "900-second timeout limit" learns nothing about
  // what to do, and an outage message carrying a request id is worse than useless.
  const raw = "429 Too Many Requests: req_id=abc123 quota exceeded for gpt-x";
  for (const probe of ["429", "req_id", "abc123", "quota", "gpt-x"]) {
    const v = failureView(raw);
    const shown = `${v.title} ${v.body} ${v.action}`;
    assert.ok(!shown.includes(probe), `"${probe}" must not appear in learner copy: ${shown}`);
  }
});

test("an auth failure does NOT offer a retry that is guaranteed to fail", () => {
  // The whole point of classifying: a control whose only outcome is the same error teaches the learner that
  // the app is broken or that they are doing it wrong.
  const v = failureView("401 Unauthorized: invalid api key");
  assert.equal(v.retryable, false);
  assert.equal(v.action, "", "no dead-end button");
  assert.match(v.body, /key|credential|sign in/i, "and it says what actually needs fixing");
});

test("an outage is described as the provider's problem, not the learner's", () => {
  const v = failureView("503 Service Unavailable");
  assert.match(v.body, /provider|service|down|unavailable/i);
  assert.equal(v.retryable, true, "an outage clears, so retrying is the right instruction");
});

test("every classification produces DISTINCT copy", () => {
  // If two causes read identically, the classification has bought nothing and the learner cannot act on it.
  const raws = ["timed out", "429 rate limit", "503 unavailable", "401 api key", "who knows"];
  const titles = raws.map((r) => failureView(r).title);
  assert.equal(new Set(titles).size, titles.length, `titles must differ: ${JSON.stringify(titles)}`);
});

test("an EMPTY message still produces usable copy", () => {
  // A failure with no text at all must not render a blank box — that is the silent state being fixed.
  const v = failureView("");
  assert.ok(v.title.length > 0 && v.body.length > 0);
  assert.equal(v.retryable, true);
});

test("the wait is named, and names the retry when one is in flight", () => {
  assert.equal(waitingNotice(0), "Socrates is thinking…");
  assert.match(waitingNotice(12_000), /12s/, "elapsed time is visible so a stall is legible");
  assert.match(waitingNotice(45_000, { attempt: 2, maxAttempts: 3 }), /retrying.*2.*3/i);
});

test("a long wait tells the learner they have a choice, rather than only spinning", () => {
  const notice = waitingNotice(95_000);
  assert.match(notice, /95s/);
  assert.match(notice, /wait|try again|stop/i, "a long wait offers an action, not just patience");
});

test("the waiting copy never claims the turn failed — it is still running", () => {
  for (const ms of [0, 5_000, 60_000, 179_000]) {
    const notice = waitingNotice(ms);
    assert.ok(!/failed|error|couldn't couldn't/i.test(notice), `must not report failure while working: ${notice}`);
  }
});
