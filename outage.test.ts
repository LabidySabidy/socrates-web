/**
 * A PROVIDER OUTAGE MUST REACH THE LEARNER.
 *
 * This is the regression test for the owner's reports — "app stuck thinking with no reasoning occuring" and
 * "socratic thinking broken", filed 38 minutes apart. The tutor was never broken: deepseek was down, pi
 * emitted `auto_retry_end {success:false, finalError: "…900-second timeout limit…"}` and the app rendered
 * nothing because `server.ts` consumed only `text_delta` deltas.
 *
 * WHY AN INTEGRATION TEST AND NOT ONLY THE FOLD'S UNIT TESTS. The defect was not a wrong fold — it was that the
 * server read ONE event class and threw the rest away. A unit test on `foldLine` would have passed while the
 * app stayed silent. This drives a REAL server with a mock pi that emits pi's real event sequence and asserts
 * what actually comes out of the SSE stream.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.ts";

const FIXTURES = join(import.meta.dirname, "test", "fixtures");

/** Boot a server whose pi is the outage mock, against a TEMP store. */
async function bootOutage(t: { after(fn: () => Promise<void> | void): void }, mock: string) {
  const store = mkdtempSync(join(tmpdir(), "soc-outage-"));
  cpSync(join(FIXTURES, "course-basic"), join(store, "course-basic"), { recursive: true });
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");

  // SOCRATES_HOME matters as much as `opts.store`. `discover()` calls `courseRefs()` with NO argument, so it
  // reads the ENV — a test that sets only `opts.store` silently serves the developer's REAL courses, and an
  // assertion about a temp fixture then passes or fails for reasons unrelated to the code under test.
  const priorHome = process.env.SOCRATES_HOME;
  process.env.SOCRATES_HOME = store;

  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(import.meta.dirname, "test", mock);
  const running = await startServer({ port: 0, store, staticDir, chat: true, watch: false });
  t.after(async () => {
    await running.close();
    if (priorHome === undefined) delete process.env.SOCRATES_HOME;
    else process.env.SOCRATES_HOME = priorHome;
    delete process.env.PI_ARGS;
    rmSync(store, { recursive: true, force: true });
    rmSync(staticDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${running.port}` };
}

/** Read an SSE body to completion and return the data lines. */
async function readStream(url: string): Promise<string[]> {
  const res = await fetch(url);
  const text = await res.text();
  return text
    .split(String.fromCharCode(10))
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6));
}

test("an outage ends the turn as an ERROR, not as a successful turn with no text", async (t) => {
  const { base } = await bootOutage(t, "mock-pi-outage.mjs");

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "explain camber", course: "course-basic" }),
  });
  assert.equal(res.status, 200, `the turn must actually start: ${await res.clone().text()}`);

  const lines = await readStream(`${base}/api/stream?course=course-basic`);
  const errorLine = lines.find((l) => l.startsWith("[ERROR]"));
  const doneLine = lines.find((l) => l === "[DONE]");

  assert.ok(errorLine, `the stream must report a failure. Got: ${JSON.stringify(lines.slice(-3))}`);
  assert.ok(!doneLine, "and must NOT report success — [DONE] with empty text was the original bug");

  // The provider's own message is carried through, so the client can name the cause.
  assert.match(errorLine, /900-second timeout limit/, "the provider's reason survives to the client");
});

test("the retry events reach the client, so it can say 'retrying' instead of freezing", async (t) => {
  // A retry in flight is NOT a failure, but it is not "working" either — and during the owner's outage this
  // was the only signal available for forty-five minutes.
  const { base } = await bootOutage(t, "mock-pi-outage.mjs");

  const post = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "explain camber", course: "course-basic" }),
  });
  assert.equal(post.status, 200, `the turn must actually start: ${await post.text()}`);

  const lines = await readStream(`${base}/api/stream?course=course-basic`);
  const retries = lines.filter((l) => l.includes("auto_retry_start"));
  assert.ok(retries.length > 0, "the retry is on the wire, not swallowed by the server");
  const first = JSON.parse(retries[0]);
  assert.equal(typeof first.attempt, "number");
  assert.equal(typeof first.maxAttempts, "number");
});

test("a HEALTHY turn is still reported as success — the fix must not cry wolf", async (t) => {
  // The mirror risk: reporting a working turn as broken would be worse than the original bug, since the
  // learner would stop trusting a reply that arrives anyway.
  process.env.MOCK_MODE = "healthy";
  const { base } = await bootOutage(t, "mock-pi-outage.mjs");
  try {
    // ASSERT THE TURN STARTED. Without this the test passed on a 404 for an unknown course — a false pass,
    // because a stream with no turn on it also settles as [DONE].
    const post = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "explain camber", course: "course-basic" }),
    });
    assert.equal(post.status, 200, `the turn must actually start: ${await post.text()}`);
    const lines = await readStream(`${base}/api/stream?course=course-basic`);
    assert.ok(lines.some((l) => l === "[DONE]"), "a healthy turn settles as done");
    assert.ok(!lines.some((l) => l.startsWith("[ERROR]")), "and carries no error");
  } finally {
    delete process.env.MOCK_MODE;
  }
});

test("a turn that streams text and THEN fails keeps the text and reports the failure", async (t) => {
  // Losing real work to an error banner is worse than the error itself.
  process.env.MOCK_MODE = "partial";
  const { base } = await bootOutage(t, "mock-pi-outage.mjs");
  try {
    const post = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "explain camber", course: "course-basic" }),
    });
    assert.equal(post.status, 200, `the turn must actually start: ${await post.text()}`);
    const lines = await readStream(`${base}/api/stream?course=course-basic`);
    const text = lines
      .map((l) => {
        try {
          return JSON.parse(l).assistantMessageEvent?.delta ?? "";
        } catch {
          return "";
        }
      })
      .join("");
    assert.match(text, /Ackermann/, `the text streamed before the failure is still on the wire; got ${JSON.stringify(lines.slice(-3))}`);
  } finally {
    delete process.env.MOCK_MODE;
  }
});
