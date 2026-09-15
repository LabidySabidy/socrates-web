/**
 * The turn outcome, and the failure a learner actually reads.
 *
 * The setup is verified from pi's source rather than invented: the event names, field names and the
 * `_retryAttempt > 0` guard on `auto_retry_end` are read from
 * `@earendil-works/pi-coding-agent/dist/core/agent-session.js`. The raw error text is the string the owner's
 * own session file contains, so these tests run on the real failure, not a paraphrase of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, foldLine, foldText, type TurnOutcome } from "./turn-result.ts";

/** The exact message pi recorded during the deepseek outage. */
const REAL_OUTAGE = "We were unable to start processing your request within the 900-second timeout limit. Please try again later.";

const fresh = (): TurnOutcome => ({ text: "" });

test("a retry exhausting reports finalError — the event that fired four times during the outage", () => {
  const line = JSON.stringify({ type: "auto_retry_end", success: false, attempt: 3, finalError: REAL_OUTAGE });
  const out = foldLine(fresh(), line);
  assert.equal(out.error, REAL_OUTAGE, "the provider's own message is carried, not replaced with a generic one");
});

test("a FAILED MESSAGE is reported even when NO retry events arrive (the CRITICAL trap)", () => {
  // `auto_retry_end` is guarded by `_retryAttempt > 0` in pi, so a first-attempt non-retryable error (bad key,
  // bad model) emits NO retry events at all. Reading only auto_retry_end would ship the same silent failure in
  // a narrower form — which is exactly the bug being fixed.
  const line = JSON.stringify({
    type: "message_update",
    message: { role: "assistant", stopReason: "error", errorMessage: "invalid api key" },
    assistantMessageEvent: { type: "done", delta: "" },
  });
  const out = foldLine(fresh(), line);
  assert.equal(out.error, "invalid api key", "a textless failed message must not be silent");
});

test("the failed message is also read from message_end, not only message_update", () => {
  const line = JSON.stringify({
    type: "message_end",
    message: { role: "assistant", stopReason: "error", errorMessage: "model not found" },
  });
  assert.equal(foldLine(fresh(), line).error, "model not found");
});

test("an in-flight retry is surfaced WITHOUT being called a failure", () => {
  // The learner should see "retrying" rather than an unchanging spinner, but the turn has not failed.
  const line = JSON.stringify({
    type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: REAL_OUTAGE,
  });
  const out = foldLine(fresh(), line);
  assert.equal(out.error, undefined, "a retry in flight is not a failure");
  assert.deepEqual(out.retrying, { attempt: 2, maxAttempts: 3, reason: REAL_OUTAGE });
});

test("a SUCCESSFUL retry clears the in-flight notice", () => {
  const retrying = foldLine(fresh(), JSON.stringify({ type: "auto_retry_start", attempt: 1, maxAttempts: 3 }));
  assert.ok(retrying.retrying, "precondition: a retry is in flight");
  const recovered = foldLine(retrying, JSON.stringify({ type: "auto_retry_end", success: true, attempt: 1 }));
  assert.equal(recovered.retrying, undefined, "a recovered turn must not keep claiming to retry");
  assert.equal(recovered.error, undefined);
});

test("TEXT STREAMED BEFORE A FAILURE IS NOT LOST", () => {
  // A turn that produced prose and then failed must keep the prose. Dropping it would replace real work with
  // an error, which is worse than the bug being fixed.
  let out = foldText(fresh(), "Ackermann geometry is about ");
  out = foldText(out, "the steering arms.");
  out = foldLine(out, JSON.stringify({ type: "auto_retry_end", success: false, finalError: REAL_OUTAGE }));
  assert.equal(out.text, "Ackermann geometry is about the steering arms.");
  assert.equal(out.error, REAL_OUTAGE, "and the error is reported alongside it, not instead of it");
});

test("a healthy turn carries no error and no retry", () => {
  let out = foldText(fresh(), "Here is what camber does.");
  out = foldLine(out, JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " more" } }));
  out = foldLine(out, JSON.stringify({ type: "agent_settled" }));
  assert.equal(out.error, undefined);
  assert.equal(out.retrying, undefined);
});

test("a non-JSON line, or an unrelated event, changes nothing", () => {
  assert.deepEqual(foldLine(fresh(), "raw stdout noise"), fresh());
  assert.deepEqual(foldLine(fresh(), JSON.stringify({ type: "tool_execution_start" })), fresh());
  assert.deepEqual(foldLine(fresh(), JSON.stringify({ type: "message_update", message: { role: "user" } })), fresh());
});

test("an assistant message that merely STOPPED is not an error", () => {
  // `stopReason` has other values ("endTurn", "maxTokens", "aborted"). Only "error" is a failure — anything
  // else would report a normal turn as broken.
  for (const stopReason of ["endTurn", "maxTokens", "aborted", undefined]) {
    const line = JSON.stringify({ type: "message_update", message: { role: "assistant", stopReason } });
    assert.equal(foldLine(fresh(), line).error, undefined, `stopReason=${stopReason} must not be an error`);
  }
});

test("a timeout is classified as a timeout, and takes precedence over a rate-limit word inside it", () => {
  assert.equal(classifyFailure(REAL_OUTAGE), "timeout");
  assert.equal(classifyFailure("429 Too Many Requests"), "rate-limit");
  assert.equal(classifyFailure("rate limit exceeded; request timed out"), "rate-limit", "specific case wins");
  assert.equal(classifyFailure("401 Unauthorized: invalid api key"), "auth");
  assert.equal(classifyFailure("503 Service Unavailable"), "outage");
  assert.equal(classifyFailure("ECONNREFUSED"), "outage");
  assert.equal(classifyFailure("something nobody has seen before"), "unknown");
  assert.equal(classifyFailure(""), "unknown");
});
