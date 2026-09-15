/**
 * The telemetry leak, end to end through the real server.
 *
 * The unit tests pin the stripper. This pins the CHANNEL — because the original defect was not a bad strip, it
 * was that the strip happened on `message_end` while the learner was watching `text_delta`. A unit test on the
 * stripper would have passed while the app still leaked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.ts";

async function boot(t: { after(fn: () => Promise<void> | void): void }, mock: string) {
  const store = mkdtempSync(join(tmpdir(), "soc-clean-"));
  cpSync(join(import.meta.dirname, "test", "fixtures", "course-basic"), join(store, "course-basic"), { recursive: true });
  const staticDir = mkdtempSync(join(tmpdir(), "soc-clean-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");

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

async function turnLines(base: string): Promise<string[]> {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "explain camber", course: "course-basic" }),
  });
  assert.equal(res.status, 200, `the turn must actually start: ${await res.text()}`);
  const text = await (await fetch(`${base}/api/stream?course=course-basic`)).text();
  return text.split(String.fromCharCode(10)).filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
}

test("NO telemetry tag reaches the client, even when it is split across deltas", async (t) => {
  // The mock streams the tag in pieces, which is the case a per-delta regex fails in 3 of 4 arrangements.
  const { base } = await boot(t, "mock-pi-telemetry-leak.mjs");
  const lines = await turnLines(base);

  // JOIN THE DELTA TEXT, NOT THE JSON LINES. The first version of this test joined the raw lines and asserted
  // the absence of "learning-telemetry" — which could never appear, because the tag is split across separate
  // JSON strings. The assertion was unfalsifiable: it passed with the fix REVERTED. Verified by reverting.
  const shown = lines
    .map((l) => {
      try { return JSON.parse(l).assistantMessageEvent?.delta ?? ""; } catch { return ""; }
    })
    .join("");

  assert.ok(!shown.includes("learning-telemetry"), `the tag leaked: ${JSON.stringify(shown)}`);
  assert.ok(!shown.includes("sm2"), `the telemetry payload leaked: ${JSON.stringify(shown)}`);
  assert.ok(!shown.includes("concept"), `telemetry content leaked: ${JSON.stringify(shown)}`);
});

test("the tutor's real prose SURVIVES the strip", async (t) => {
  // Stripping must not eat the answer. A fix that removed the reply would be worse than the leak.
  const { base } = await boot(t, "mock-pi-telemetry-leak.mjs");
  const lines = await turnLines(base);
  const text = lines
    .map((l) => {
      try { return JSON.parse(l).assistantMessageEvent?.delta ?? ""; } catch { return ""; }
    })
    .join("");
  assert.match(text, /Here is the answer/, `prose lost; got ${JSON.stringify(text)}`);
});

test("non-delta events are untouched, so failure surfacing still works", async (t) => {
  // The stripper must not rewrite `auto_retry_start` / `auto_retry_end` / `agent_settled` — the outage fix
  // depends on them arriving intact.
  const { base } = await boot(t, "mock-pi-outage.mjs");
  const lines = await turnLines(base);
  assert.ok(lines.some((l) => l.includes("auto_retry_start")), "retry events still reach the client");
  assert.ok(lines.some((l) => l.startsWith("[ERROR]")), "and the outage still surfaces as an error");
});

test("teeth check: the leak assertion CAN fail — a verbatim forward leaks", async () => {
  // The guard on this test file. The first version joined the JSON LINES and could never have detected the
  // leak — it passed while the fix was REVERTED, verified by reverting. This pins that mistake: it proves the
  // assembled reading DOES expose the tag when nothing strips it, and that the stripper removes it.
  //
  // It reads the FIXTURE'S OWN SOURCE rather than re-typing the pieces, so the guard cannot drift from the
  // fixture it guards, and it matches the single-quoted runs loosely so a rewording cannot make it vacuous.
  const mockSource = readFileSync(join(import.meta.dirname, "test", "mock-pi-telemetry-leak.mjs"), "utf8");
  // Pull the fixture's `pieces` ARRAY out and evaluate it, rather than regexing one string at a time: the
  // pieces contain escaped quotes, so a single-quote regex matches only the first. Evaluating the array means
  // this guard reads exactly what the mock sends.
  const arrSrc = mockSource.slice(mockSource.indexOf("const pieces = ["));
  const arrEnd = arrSrc.indexOf("];") + 1;
  const pieces = eval(arrSrc.slice("const pieces = ".length, arrEnd));
  assert.ok(pieces.length >= 3, `the fixture still streams the tag in pieces; found ${pieces.length}`);

  const unescape = (p) => p.split("\n").join("\n");
  const assembled = pieces.map(unescape).join("");
  assert.ok(
    assembled.includes("learning-telemetry"),
    `assembled pieces must expose the tag, else the leak test above is vacuous: ${JSON.stringify(assembled)}`,
  );

  const { createTelemetryStripper } = await import("./web/src/stream-clean.ts");
  const strip = createTelemetryStripper();
  const cleaned = pieces.map((p) => strip(unescape(p))).join("") + strip.flush();
  assert.ok(!cleaned.includes("learning-telemetry"), `the stripper removes it: ${JSON.stringify(cleaned)}`);
});

test("a recorded MISCONCEPTION becomes a notice the client can render", async (t) => {
  // The owner asked for the detail to be shown, not the raw block. This pins that the server converts the
  // captured block into a structured notice with the description intact.
  const { base } = await boot(t, "mock-pi-telemetry-leak.mjs");
  const lines = await turnLines(base);
  const notices = lines
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((o) => o?.type === "learning-notice");
  assert.equal(notices.length, 1, `exactly one notice; got ${JSON.stringify(notices)}`);
  const n = notices[0].notice;
  assert.equal(n.kind, "misconception-open");
  assert.match(n.title, /Misconception identified/);
  assert.ok(n.description.length > 0, "the description is carried so the notice has something to quote");
});

test("a PLAIN badge update produces NO notice", async (t) => {
  // 26 of 29 real events are this shape. A notice here would claim a misconception that was never recorded.
  const { base } = await boot(t, "mock-pi-badge-only.mjs");
  const lines = await turnLines(base);
  const notices = lines.filter((l) => l.includes("learning-notice"));
  assert.deepEqual(notices, [], `a plain badge change must be silent; got ${JSON.stringify(notices)}`);
});
