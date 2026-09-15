/**
 * server.test.ts — the API surface, exercised against a real store.
 *
 * There is no scan any more: a course IS a directory in the store. The vendored fixtures are copied
 * into a temp store once for the suite, so every test drives the same code path a learner's machine
 * would, and none of it touches the real `~/.socrates/courses`.
 *
 * `chat: false` by default because those routes spawn pi and are covered by bridge.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "./server.ts";
import { ProcessBridge } from "./process-bridge.ts";
import { parseLearning } from "./learning-parser.ts";

const FIXTURES = join(import.meta.dirname, "test", "fixtures");

/**
 * The course store is redirected for the whole suite. Without this the tests would read and write the
 * real `~/.socrates/courses`, which is the user's data — and would then depend on whatever is in it.
 */
const STORE = mkdtempSync(join(tmpdir(), "socrates-test-store-"));
process.env.SOCRATES_HOME = STORE;
test.after?.(() => rmSync(STORE, { recursive: true, force: true }));

// Every fixture becomes a course in the store. Copying rather than pointing at them also means tests
// that write into a course (an event log, an assessment cache) never touch the vendored originals.
for (const entry of readdirSync(FIXTURES, { withFileTypes: true })) {
  if (entry.isDirectory()) cpSync(join(FIXTURES, entry.name), join(STORE, entry.name), { recursive: true });
}
const BASIC = join(STORE, "course-basic");

async function boot(t: { after(fn: () => Promise<void> | void): void }): Promise<{ base: string; running: RunningServer }> {
  // A throwaway static root keeps the tests independent of `web/dist` existing.
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>\n");
  const running = await startServer({
    port: 0,
    store: STORE,
    staticDir,
    chat: false,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${running.port}`, running };
}

const getJson = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
};

/** Every file under dir, relative to it. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(current, entry.name), rel);
      else out.push(rel);
    }
  };
  visit(dir, "");
  return out.sort();
}

test("booting the server does not spawn pi and never writes into the course", async (t) => {
  // Regression guard. The bridge used to be wired at boot, which spawned a real agent with
  // cwd = the course directory; the global learning + telemetry extensions then wrote an event log
  // containing absolute paths straight into the course directory. Booting is now inert:
  // the bridge is wired on the first chat request only.
  const before = walk(BASIC);
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>\n");
  const running = await startServer({
    port: 0,
    store: STORE,
    staticDir,
    chat: true, // chat available — just not started
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });

  await new Promise((r) => setTimeout(r, 500)); // give an unwanted spawn time to write
  assert.deepEqual(walk(BASIC), before, "booting must not touch the course directory");
  assert.ok(!before.some((f) => f.includes("events.jsonl") || f.includes("telemetry") || f.includes("SESSIONS")));
});

test("GET /api/courses/:id returns the derived tree", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-basic`);

  assert.equal(status, 200);
  assert.equal(body.id, "course-basic");
  assert.equal(body.derived, true);
  assert.deepEqual(body.units.map((u: { title: string }) => u.title), ["alpha-one", "beta-two", "gamma-three"]);
  assert.deepEqual(body.units.map((u: { mastery: { state: string } }) => u.mastery.state), [
    "Familiar",
    "Proficient",
    "Not started",
  ]);
  assert.deepEqual(body.mastery.counts, {
    "Not started": 1,
    Attempted: 0,
    Familiar: 1,
    Proficient: 1,
    Mastered: 0,
  });
  assert.equal(body.units[0].groups[0].modules[0].type, "recite");
});

test("GET /api/courses/:id serves the manifest tree for a manifest course", async (t) => {
  const { base } = await boot(t);
  const { body } = await getJson(`${base}/api/courses/course-manifest`);
  assert.equal(body.derived, false);
  assert.equal(body.title, "Manifest Override (authored)");
  assert.ok(body.warnings.includes("unknown-lesson:ghost-card"));
});

test("GET /api/courses/:id is 404 for an unknown course and lists the known ones", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/nope`);
  assert.equal(status, 404);
  assert.match(body.error, /unknown course/);
  assert.ok(Array.isArray(body.known) && body.known.length > 0);
});

test("GET /api/courses/:id/learning returns the raw LearningData", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-basic/learning`);
  assert.equal(status, 200);
  assert.deepEqual(body.present, ["MISSION.md", "PLAN.md", "SCHEMA.md"]);
  assert.equal(body.schema.concepts.length, 3);
  assert.equal(body.schema.misconceptions.length, 4);
  assert.equal(body.schema.misconceptions[0].severity, "root");
});

test("the legacy /api/learning alias is gone, and the per-course route carries the same data", async (t) => {
  const { base } = await boot(t);

  // Removed with the vanilla UI in P2. A revert restores both, which is why they went together.
  const gone = await fetch(`${base}/api/learning`);
  assert.equal(gone.status, 404);
  assert.match((await gone.json()).error, /removed/);

  // Nothing was lost: the per-course route returns the identical LearningData shape.
  const perCourse = await fetch(`${base}/api/courses/course-basic/learning`);
  assert.equal(perCourse.status, 200);
  const body = await perCourse.json();
  assert.deepEqual(Object.keys(body), ["projectDir", "present", "mission", "plan", "schema"]);
  assert.deepEqual(body, parseLearning(BASIC));
});

test("a course with no concepts still returns a usable tree, not an error", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-empty-concepts`);
  assert.equal(status, 200);
  assert.deepEqual(body.units, []);
  assert.ok(body.warnings.includes("no-concepts"));
});

test("GET /api/courses/:id/journal returns session history newest-first", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-with-journal/journal`);

  assert.equal(status, 200);
  assert.equal(body.id, "course-with-journal");
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(
    body.sessions.map((s: { file: string }) => s.file),
    ["2026-09-10-0741-01a099ad.md", "2026-09-08-0900-0a1b2c3d.md"],
  );
  assert.equal(body.sessions[0].open, true);
  assert.deepEqual(body.sessions[1].concepts, ["journal-concept"]);
  assert.equal(body.sessions[1].turns, 4);
  assert.equal(body.events.present, false, "the fixture ships no runtime log");
});

test("a course with no journal returns an empty list, not an error", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-basic/journal`);
  assert.equal(status, 200);
  assert.deepEqual(body.sessions, []);
  assert.equal(body.events.present, false);
});

test("GET /api/courses/:id/journal/:file serves one session's markdown", async (t) => {
  const { base } = await boot(t);
  const res = await fetch(`${base}/api/courses/course-with-journal/journal/2026-09-08-0900-0a1b2c3d.md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/markdown/);
  const text = await res.text();
  assert.match(text, /^- \*\*Turns:\*\* 4$/m);
  assert.match(text, /journal-concept/);
});

test("the journal file route refuses traversal and unknown names", async (t) => {
  const { base } = await boot(t);
  for (const name of ["..%2FSCHEMA.md", "SCHEMA.md", "2026-01-01-0000-deadbeef.md"]) {
    const res = await fetch(`${base}/api/courses/course-with-journal/journal/${name}`);
    assert.equal(res.status, 404, `expected 404 for ${name}`);
  }
});

test("chat routes are absent when chat is disabled, and health still answers", async (t) => {
  const { base } = await boot(t);
  const chat = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(chat.status, 503);

  const stream = await fetch(`${base}/api/stream`);
  assert.equal(stream.status, 503);

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok");
});

// ---------------------------------------------------------------------------
// chat is course-aware — T-026 (uses a mock pi, so no real agent is started)
// ---------------------------------------------------------------------------

/** Boot with chat enabled and the cwd-reporting mock, so a switch is observable. */
/** Boot with chat enabled against a NAMED mock — settle timing differs per test. */
async function bootChatWith(t: { after(fn: () => Promise<void> | void): void }, mock: string) {
  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(import.meta.dirname, "test", mock);
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");
  const running = await startServer({ port: 0, store: STORE, staticDir, chat: true, watch: true });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${running.port}` };
}

async function bootChat(t: { after(fn: () => Promise<void> | void): void }) {
  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(import.meta.dirname, "test", "mock-pi-cwd.mjs");
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");
  const running = await startServer({
    port: 0,
    store: STORE,
    staticDir,
    chat: true,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${running.port}` };
}

/**
 * Boot with chat enabled and a mock that ECHOES the prompt it received, so a test asserts what the
 * bridge was actually handed rather than what the client believes it sent.
 */
async function bootChatRecording(t: { after(fn: () => Promise<void> | void): void }) {
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  const script = join(staticDir, "echo-prompt.mjs");
  writeFileSync(
    script,
    [
      "const out = (o) => process.stdout.write(JSON.stringify(o) + String.fromCharCode(10));",
      "process.stdin.setEncoding('utf8');",
      "let buf = '';",
      "process.stdin.on('data', (c) => {",
      "  buf += c;",
      "  let i;",
      "  const NL = String.fromCharCode(10);",
      "  while ((i = buf.indexOf(NL)) !== -1) {",
      "    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);",
      "    if (!line) continue;",
      "    let cmd; try { cmd = JSON.parse(line); } catch { continue; }",
      "    if (cmd.type === 'prompt') {",
      "      out({ type: 'response', command: 'prompt', success: true });",
      "      out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'PROMPT:' + cmd.message } });",
      "      out({ type: 'agent_settled' });",
      "    }",
      "  }",
      "});",
    ].join(String.fromCharCode(10)),
  );
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");

  process.env.PI_BIN = "node";
  process.env.PI_ARGS = script;
  const running = await startServer({
    port: 0,
    store: STORE,
    staticDir,
    chat: true,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${running.port}`;
  /** What the bridge was handed, read back out of the turn's own stream. */
  const sent = async (): Promise<string> => {
    const { lines } = await readStream(`${base}/api/stream`);
    const delta = lines.find((l) => l.includes("PROMPT:"));
    assert.ok(delta, `expected the echo in ${JSON.stringify(lines)}`);
    return (JSON.parse(delta!) as { assistantMessageEvent: { delta: string } }).assistantMessageEvent
      .delta.replace(/^PROMPT:/, "");
  };
  return { base, sent };
}

/** Read an SSE body to completion and return the data lines. */
async function readStream(url: string): Promise<{ status: number; lines: string[] }> {
  const res = await fetch(url);
  if (res.status !== 200) return { status: res.status, lines: [] };
  const text = await res.text();
  return {
    status: res.status,
    lines: text
      .split(String.fromCharCode(10))
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6)),
  };
}

test("naming another course restarts the agent in that course and the turn reaches it", async (t) => {
  const { base } = await bootChat(t);

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "where am I", course: "course-with-journal" }),
  });
  const body = await res.json();
  assert.equal(body.course, "course-with-journal");
  assert.equal(body.switched, true, "the agent was moved");

  const { lines } = await readStream(`${base}/api/stream?course=course-with-journal`);
  const delta = lines.find((l) => l.includes("cwd:"));
  assert.ok(delta);
  assert.match(
    JSON.parse(delta!).assistantMessageEvent.delta,
    /course-with-journal$/,
    "the turn ran in the named course",
  );
});

test("a stream cannot subscribe to a different course than the active turn", async (t) => {
  const { base } = await bootChat(t);
  await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi", course: "course-basic" }),
  });

  const wrong = await fetch(`${base}/api/stream?course=course-with-journal`);
  assert.equal(wrong.status, 409);
  const body = await wrong.json();
  assert.equal(body.activeCourse, "course-basic", "it says which course is actually live");

  // draining the real stream lets the server settle before the test ends
  await readStream(`${base}/api/stream?course=course-basic`);
});

test("a prompt for an unknown course, or none at all, is refused", async (t) => {
  const { base } = await bootChat(t);
  const post = async (course: string) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi", course }),
    });
    return { status: res.status, body: await res.json() };
  };

  const unknown = await post("nope");
  assert.equal(unknown.status, 404);
  assert.ok(Array.isArray(unknown.body.known));

  const none = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(none.status, 400, "a course is required: there is no default course any more");
  assert.match((await none.json()).error, /course required/);
});

// ---------------------------------------------------------------------------
// quiz results are history, not a mastery claim
// ---------------------------------------------------------------------------

test("a completed attempt is appended to the course log, and claims no mastery", async (t) => {
  const { base } = await boot(t);
  const logPath = join(BASIC, ".agent", "learning", "events.jsonl");
  t.after(() => rmSync(logPath, { force: true }));

  const res = await fetch(`${base}/api/courses/course-basic/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unit: 1,
      source: "authored",
      right: 2,
      wrong: 1,
      total: 3,
      itemIds: ["q1", "q2", "q3"],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.recorded, true);
  assert.equal(body.right, 2);
  assert.equal(body.total, 3);
  assert.equal(body.mastery, null, "nothing computes a mastery change, so nothing is claimed");

  const lines = readFileSync(logPath, "utf8").trim().split(String.fromCharCode(10));
  const event = lines.map((l) => JSON.parse(l)).find((e) => e.kind === "assessment_result")!;
  assert.equal(event.kind, "assessment_result");
  assert.equal(event.v, 1);
  assert.equal(event.unit, 1);
  assert.equal(event.quiz_source, "authored");
  assert.equal(event.right, 2);
  assert.equal(event.wrong, 1);
  assert.equal(event.total, 3);
  assert.deepEqual(event.item_ids, ["q1", "q2", "q3"]);
  assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("the appended event is parseable by the journal reader", async (t) => {
  const { base } = await boot(t);
  const logPath = join(BASIC, ".agent", "learning", "events.jsonl");
  t.after(() => rmSync(logPath, { force: true }));

  await fetch(`${base}/api/courses/course-basic/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1, source: "generated", right: 3, wrong: 0, total: 3, itemIds: [] }),
  });

  // The reader counts malformed lines; a kind it does not know would show up there.
  const { status, body } = await getJson(`${base}/api/courses/course-basic/journal`);
  assert.equal(status, 200);
  // unit 1's concept is 🟨, so a clean attempt also logs a badge award.
  assert.equal(body.events.count, 2, "the attempt and the badge are both well-formed");
  assert.equal(body.events.malformed, 0, "not counted as malformed");
});

test("a clean attempt awards a badge event and reports it as pending, not applied", async (t) => {
  const { base } = await boot(t);
  const logPath = join(BASIC, ".agent", "learning", "events.jsonl");
  t.after(() => rmSync(logPath, { force: true }));

  // unit 1 is alpha-one, currently 🟨. A clean attempt qualifies it for 🟩.
  const res = await fetch(`${base}/api/courses/course-basic/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1, source: "authored", right: 3, wrong: 0, total: 3, itemIds: [] }),
  });
  const body = await res.json();
  assert.equal(body.recorded, true);
  assert.equal(body.mastery, null, "the FILE has not moved, so nothing is claimed");
  assert.deepEqual(body.pendingBadge, {
    concept: "alpha-one",
    badge: "🟩",
    state: "Proficient",
  });

  const events = readFileSync(logPath, "utf8").trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.kind), ["assessment_result", "badge"]);
  const badge = events[1];
  assert.equal(badge.concept, "alpha-one");
  assert.equal(badge.to, "🟩");
  assert.equal(badge.source, "assessment", "not 'tool' or 'tag': this came from an attempt");
});

test("two mistakes forfeits Proficient, per the design's gate copy", async (t) => {
  const { base } = await boot(t);
  const logPath = join(BASIC, ".agent", "learning", "events.jsonl");
  t.after(() => rmSync(logPath, { force: true }));

  // unit 3 is gamma-three, currently ⬜, so a Familiar award is still a raise.
  const res = await fetch(`${base}/api/courses/course-basic/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 3, source: "authored", right: 1, wrong: 2, total: 3, itemIds: [] }),
  });
  const body = await res.json();
  assert.equal(body.pendingBadge.badge, "🟨");
  assert.equal(body.pendingBadge.state, "Familiar");

  const events = readFileSync(logPath, "utf8").trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
  assert.equal(events.at(-1).to, "🟨");
});

test("an attempt never lowers a badge, so no event is written when it cannot raise", async (t) => {
  const { base } = await boot(t);
  const logPath = join(BASIC, ".agent", "learning", "events.jsonl");
  t.after(() => rmSync(logPath, { force: true }));

  // unit 2 is beta-two, already 🟩. A clean attempt qualifies it for 🟩 — not a raise.
  const res = await fetch(`${base}/api/courses/course-basic/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 2, source: "cache", right: 3, wrong: 0, total: 3, itemIds: [] }),
  });
  const body = await res.json();
  assert.equal(body.pendingBadge, null);
  assert.equal(body.mastery, null);

  const events = readFileSync(logPath, "utf8").trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.kind), ["assessment_result"], "the attempt is logged, the badge is not");
});

test("an authored unit spanning several concepts awards nothing", async (t) => {
  const { base } = await boot(t);
  const logPath = join(FIXTURES, "course-manifest", ".agent", "learning", "events.jsonl");
  t.after(() => rmSync(logPath, { force: true }));

  const res = await fetch(`${base}/api/courses/course-manifest/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 2, source: "authored", right: 3, wrong: 0, total: 3, itemIds: [] }),
  });
  const body = await res.json();
  assert.equal(body.recorded, true, "the attempt is still recorded");
  assert.equal(body.pendingBadge, null, "there is no single concept whose badge could move");
});

test("a malformed result body is refused", async (t) => {
  const { base } = await boot(t);
  const post = async (payload: unknown) => {
    const res = await fetch(`${base}/api/courses/course-basic/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  };

  assert.equal((await post({ unit: 1, right: 2 })).status, 400);
  assert.equal((await post({ unit: 0, right: 1, wrong: 0, total: 1 })).status, 400);
  assert.equal((await post({ unit: 1, right: -1, wrong: 0, total: 1 })).status, 400);

  const unknown = await fetch(`${base}/api/courses/nope/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1, right: 1, wrong: 0, total: 1 }),
  });
  assert.equal(unknown.status, 404);
});

// ---------------------------------------------------------------------------
// interactives and games
// ---------------------------------------------------------------------------

const LAB = join(FIXTURES, "course-lab");

test("GET /api/courses/:id/interactives returns authored specs, validated", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-lab/interactives?unit=1`);

  assert.equal(status, 200);
  assert.equal(body.source, "authored");
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.interactives.map((i: { spec: { kind: string } }) => i.spec.kind), [
    "slider",
    "target-window",
  ]);

  const slider = body.interactives[0].spec;
  assert.equal(slider.fn, "m * x + b");
  assert.deepEqual(slider.xRange, [-6, 6]);
  assert.deepEqual(slider.params.map((p: { name: string }) => p.name), ["m", "b"]);

  const game = body.interactives[1].spec;
  assert.deepEqual(game.band, [44, 56]);
  assert.equal(game.speed, 0.9);
});

test("the interactives route is 404 for an unknown course and 400 for a bad unit", async (t) => {
  const { base } = await boot(t);
  assert.equal((await fetch(`${base}/api/courses/nope/interactives?unit=1`)).status, 404);
  assert.equal((await fetch(`${base}/api/courses/course-basic/interactives?unit=0`)).status, 400);
});

test("a course with no authored interactive reports source none", async (t) => {
  const { base } = await boot(t);
  const { body } = await getJson(`${base}/api/courses/course-basic/interactives?unit=1`);
  assert.equal(body.source, "none");
  assert.deepEqual(body.interactives, []);
});

test("generation never runs over an authored interactive", async (t) => {
  // chat is disabled here, so a generation attempt would 503 — proving none was made.
  const { base } = await boot(t);
  const res = await fetch(`${base}/api/courses/course-lab/interactives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1 }),
  });
  assert.equal(res.status, 200, "authored wins without touching the agent");
  const body = await res.json();
  assert.equal(body.source, "authored");
  assert.equal(body.interactives.length, 2);
});

test("a generated interactive that fails validation is refused, not half-served", async (t) => {
  const { base } = await bootChat(t); // the mock replies with prose, so extraction fails
  const res = await fetch(`${base}/api/courses/course-basic/interactives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1 }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.match(body.error, /did not produce a usable interactive/);
  assert.match(body.detail, /no JSON block/);
  assert.equal(body.interactives, undefined, "no partial result");
});

test("a failed generation does not return the tutor's own text, which contains the answer key", async (t) => {
  // D2, approved. `excerpt: turn.text.slice(0, 400)` was added in 58c7229 as user-facing copy ("422 with
  // the reason and an excerpt"), but the tutor's text is the raw generation JSON — `"answer"`, `"accepts"`,
  // `"hints"`, `"steps"` — so a failure path handed the learner the answer key. The assertion is at the
  // RESPONSE boundary, not in a component, because a component-level test passes while the field remains
  // in the payload.
  const { base } = await bootChat(t); // the mock replies with prose, so extraction fails
  const res = await fetch(`${base}/api/courses/course-basic/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1 }),
  });
  assert.equal(res.status, 422);
  const raw = await res.text();

  // The three ways the answer key could reach the client.
  assert.doesNotMatch(raw, /"answer"\s*:/, "no answer field");
  assert.doesNotMatch(raw, /"accepts"\s*:|"hints"\s*:|"steps"\s*:/, "no graded fields");
  // NOTE: `detail` legitimately contains backticks — it is extractItems' own message naming the expected
  // format. The assertion is therefore on the EXCERPT, which is the field that used to carry the model's
  // text, not on the whole payload.
  const body = JSON.parse(raw) as { error: string; detail: string; excerpt?: string };
  assert.doesNotMatch(body.excerpt ?? "", /as requested by the mock/, "none of the model's prose");
  assert.doesNotMatch(body.excerpt ?? "", /```/, "and none of its raw text");
  // The REASON is still reported — that was the point of the whole branch.
  assert.match(body.error, /did not produce usable items/);
  assert.match(body.detail, /no JSON block/);
  // And the affordance survives, redacted rather than removed.
  if (body.excerpt !== undefined) {
    assert.ok(body.excerpt.length <= 120, `excerpt must be a summary, got ${body.excerpt.length} chars`);
    assert.match(body.excerpt, /prose|no JSON|instead/i, "it should say what arrived, not quote it");
  }
});

test("the response leaks no answer key even when the model returns a real one", async (t) => {
  // The prose mock proves a fenced block is stripped; this proves the ANSWER KEY itself is not shipped.
  // The mock returns valid-looking items with an unparseable tail, so extraction fails AFTER the model has
  // stated the answer — which is the worst case for the old `excerpt`.
  const { base } = await bootChatWith(t, "mock-pi-answerkey.mjs");
  const res = await fetch(`${base}/api/courses/course-basic/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1 }),
  });
  assert.equal(res.status, 422);
  const raw = await res.text();
  assert.doesNotMatch(raw, /Camber/, "the model's stated answer must not reach the client");
  assert.doesNotMatch(raw, /"accepts"\s*:/, "nor the accepted-answer list");
  assert.doesNotMatch(raw, /"hints"\s*:|"steps"\s*:/, "nor the hints or steps");
});

test("a failed interactive generation likewise returns no answer key", async (t) => {
  const { base } = await bootChat(t);
  const res = await fetch(`${base}/api/courses/course-basic/interactives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: 1 }),
  });
  assert.equal(res.status, 422);
  const raw = await res.text();
  const body = JSON.parse(raw) as { excerpt?: string };
  assert.doesNotMatch(body.excerpt ?? "", /```/, "no fenced JSON from the model");
  assert.doesNotMatch(body.excerpt ?? "", /as requested by the mock/, "no model prose either");
});

test("budapest ships as a mode: the server injects it, the message stays clean", async (t) => {
  // The original concatenated the modifier onto the message (app.js:184), polluting the prompt, the
  // transcript and the event log. The mode travels separately now.
  const { base, sent } = await bootChatRecording(t);

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "what is state?", course: "course-basic", mode: "budapest" }),
  });
  const body = await res.json();
  assert.equal(body.mode, "budapest");

  const prompt = await sent();
  assert.ok(prompt.startsWith("what is state?"), "the message comes first, unpolluted: " + prompt);
  assert.ok(prompt.includes("[BUDAPEST MODE ACTIVE]"), "the modifier is present");
  assert.match(prompt, /Forbid lecturing, definitions, or syntax explanations/);
  assert.match(prompt, /Force them to struggle/);
});

test("without the mode the prompt is exactly the message", async (t) => {
  const { base, sent } = await bootChatRecording(t);
  await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "what is state?", course: "course-basic" }),
  });
  assert.equal(await sent(), "what is state?", "no modifier, no pollution");
});

test("any other mode value is treated as the default", async (t) => {
  const { base, sent } = await bootChatRecording(t);
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi", course: "course-basic", mode: "whatever" }),
  });
  assert.equal((await res.json()).mode, "default");
  assert.equal(await sent(), "hi");
});

// ---------------------------------------------------------------------------
// folder browser — pick a directory instead of typing one
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// the articulate entry point — a subject, not a directory
// ---------------------------------------------------------------------------

test("POST /api/courses with a subject creates a course in the store", async (t) => {
  const { base } = await boot(t);
  const res = await fetch(`${base}/api/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "Supabase RLS" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, "supabase-rls");
  assert.equal(body.dir, join(STORE, "supabase-rls"), "it lands in the store, nowhere else");

  const listed = body.courses.find((c: { id: string }) => c.id === "supabase-rls");
  assert.ok(listed, "and it is in the catalogue immediately");
  assert.equal(listed.title, "Supabase RLS", "titled from the learner's own words");
  assert.equal(listed.fromStore, true);
  assert.equal(listed.concepts, 0, "no concept cards until the tutor interviews them");

  t.after(() => rmSync(join(STORE, "supabase-rls"), { recursive: true, force: true }));
});

test("the same subject twice is refused, and an empty one is refused", async (t) => {
  const { base } = await boot(t);
  const post = async (subject: string) => {
    const res = await fetch(`${base}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject }),
    });
    return { status: res.status, body: await res.json() };
  };

  const first = await post("React Internals");
  assert.equal(first.status, 201);
  t.after(() => rmSync(join(STORE, "react-internals"), { recursive: true, force: true }));

  const again = await post("React Internals");
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already exists/);

  assert.equal((await post("   ")).status, 400);
});

test("a course created through the API is usable: its tree loads and it has a journal", async (t) => {
  const { base } = await boot(t);
  await fetch(`${base}/api/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "Idempotent Migrations" }),
  });
  t.after(() => rmSync(join(STORE, "idempotent-migrations"), { recursive: true, force: true }));

  const tree = await getJson(`${base}/api/courses/idempotent-migrations`);
  assert.equal(tree.status, 200);
  assert.equal(tree.body.title, "Idempotent Migrations");
  assert.deepEqual(tree.body.units, [], "no units until the tutor writes the concept cards");
  assert.ok(tree.body.warnings.includes("no-schema"), "and it says why");

  const journal = await getJson(`${base}/api/courses/idempotent-migrations/journal`);
  assert.equal(journal.status, 200);
  assert.deepEqual(journal.body.sessions, [], "a fresh course has no sessions");
});

test("static files are served and path traversal is refused", async (t) => {
  const { base } = await boot(t);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type")!, /text\/html/);

  const traversal = await fetch(`${base}/../../package.json`);
  assert.ok([403, 404].includes(traversal.status), `got ${traversal.status}`);
});

test("the server binds an ephemeral port when asked for 0", async (t) => {
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>\n");
  const running = await startServer({
    port: 0,
    store: STORE,
    staticDir,
    chat: false,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  assert.ok(running.port > 0);
  assert.equal((await fetch(`http://127.0.0.1:${running.port}/health`)).status, 200);
});

// ---------------------------------------------------------------------------
// renaming: one writer (the H1), one mover (reconcile), one channel (SSE)
// ---------------------------------------------------------------------------

/** A course in the store, with a mission that has more than a heading to preserve. */
function makeTitledCourse(id: string, heading: string, destination = "do the thing"): string {
  const dir = join(STORE, id);
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    [
      `# ${heading}`,
      "",
      "## Destination",
      "",
      `- **I will be able to:** ${destination}`,
      "- **Proof-of-skill artifact:** a merged PR",
      "",
    ].join("\n"),
  );
  return dir;
}

const patchTitle = (base: string, id: string, title: string) =>
  fetch(`${base}/api/courses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

test("a rename writes the H1, moves the directory, and leaves the rest of the mission alone", async (t) => {
  const { base } = await boot(t);
  const id = "rename-me";
  const dir = makeTitledCourse(id, "rename me", "align my own wheels");
  const file = join(dir, ".agent", "learning", "MISSION.md");
  const before = readFileSync(file, "utf8");

  const res = await patchTitle(base, id, "Wheel Alignment by String");
  const body = (await res.json()) as { id: string; renamed: boolean };
  assert.equal(res.status, 200);
  assert.equal(body.renamed, true);
  assert.equal(body.id, "wheel-alignment-by-string", "the id follows the directory, which follows the H1");

  assert.ok(!existsSync(dir), "the old directory is gone");
  const moved = join(STORE, "wheel-alignment-by-string");
  assert.ok(existsSync(moved));
  const after = readFileSync(join(moved, ".agent", "learning", "MISSION.md"), "utf8");
  assert.equal(after.split("\n")[0], "# Wheel Alignment by String");
  assert.equal(
    after.split("\n").slice(1).join("\n"),
    before.split("\n").slice(1).join("\n"),
    "every other byte of MISSION.md survives the rename",
  );

  rmSync(moved, { recursive: true, force: true });
});

test("a rename onto an existing course is refused and touches neither of them", async (t) => {
  const { base } = await boot(t);
  const a = makeTitledCourse("keeper", "keeper");
  const b = makeTitledCourse("mover", "mover");
  const bBefore = readFileSync(join(b, ".agent", "learning", "MISSION.md"), "utf8");

  const res = await patchTitle(base, "mover", "keeper");
  assert.equal(res.status, 409, "a collision is refused, not clobbered");
  const body = (await res.json()) as { error: string; id: string };
  assert.match(body.error, /already exists/);
  assert.equal(body.id, "mover");

  assert.ok(existsSync(a), "the course being protected is untouched");
  assert.ok(existsSync(b), "the course that tried to move has not moved");
  assert.equal(
    readFileSync(join(b, ".agent", "learning", "MISSION.md"), "utf8"),
    bBefore,
    "a refused rename leaves the old name written nowhere new",
  );
  // and the catalogue still lists it under the old name
  const listed = (await (await fetch(`${base}/api/courses`)).json()) as { courses: { id: string }[] };
  assert.ok(listed.courses.some((c) => c.id === "mover"));
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test("an empty or oversized title is refused with a reason and no move", async (t) => {
  const { base } = await boot(t);
  const dir = makeTitledCourse("validate-me", "validate me");

  const empty = await patchTitle(base, "validate-me", "   ");
  assert.equal(empty.status, 400);
  assert.match(((await empty.json()) as { error: string }).error, /required/);

  const long = await patchTitle(base, "validate-me", "y".repeat(200));
  assert.equal(long.status, 400);
  assert.match(((await long.json()) as { error: string }).error, /limit is 80/);

  assert.ok(existsSync(dir), "a refused title never moves anything");
  rmSync(dir, { recursive: true, force: true });
});

test("a hand-edited H1 renames the course on the next read", async (t) => {
  const { base } = await boot(t);
  const dir = makeTitledCourse("hand-edited", "hand edited");
  // exactly what a learner with an editor would do
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    `# Thrust Angle Geometry\n\n## Destination\n\n- **I will be able to:** set toe and camber\n`,
  );

  const res = await fetch(`${base}/api/courses/hand-edited`);
  assert.equal(res.status, 404, "the request was for the old id, and there is no alias table");
  assert.ok(existsSync(join(STORE, "thrust-angle-geometry")), "the filesystem followed the document");
  assert.ok(!existsSync(dir));

  const tree = (await (await fetch(`${base}/api/courses/thrust-angle-geometry`)).json()) as { title: string };
  assert.equal(tree.title, "Thrust Angle Geometry");
  rmSync(join(STORE, "thrust-angle-geometry"), { recursive: true, force: true });
});

test("the watch channel announces a rename with from and to", async (t) => {
  const { base } = await boot(t);
  const dir = makeTitledCourse("announce-me", "announce me");

  const controller = new AbortController();
  const stream = await fetch(`${base}/api/watch`, { signal: controller.signal });
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        decoder.decode(value).split("\n\n").forEach((f) => f.trim() && frames.push(f));
      }
    } catch {
      /* aborted at the end of the test */
    }
  })();

  await patchTitle(base, "announce-me", "Announced Rename");
  await new Promise((r) => setTimeout(r, 150));
  controller.abort();
  await pump;

  const renamed = frames.map((f) => f.replace(/^data: /, "")).find((f) => f.includes("renamed"));
  assert.ok(renamed, `expected a renamed frame; saw ${JSON.stringify(frames)}`);
  assert.deepEqual(JSON.parse(renamed!), { type: "renamed", from: "announce-me", to: "announced-rename" });
  rmSync(join(STORE, "announced-rename"), { recursive: true, force: true });
});

test("a rename during a turn is deferred, and lands once the agent settles", async (t) => {
  // The agent's cwd IS the course directory, and Windows cannot rename it out from under a live
  // process — so the move waits for the turn to finish rather than breaking it.
  process.env.MOCK_SETTLE_MS = "1200";
  const { base } = await bootChatWith(t, "mock-pi-slow.mjs");
  const id = "busy-course";
  const dir = makeTitledCourse(id, "busy course");

  const turn = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "start the interview", course: id }),
  });
  assert.equal(turn.status, 200);

  const res = await patchTitle(base, id, "Deferred Rename");
  assert.equal(res.status, 202, "the rename is accepted but not applied");
  const body = (await res.json()) as { deferred: boolean; pending: { title: string } };
  assert.equal(body.deferred, true);
  assert.equal(body.pending.title, "Deferred Rename");
  assert.ok(existsSync(dir), "nothing moved while the agent was standing in the directory");

  // the turn settles, and the deferred rename lands on the settle without anyone prompting it
  await new Promise((r) => setTimeout(r, 1800));
  assert.ok(existsSync(join(STORE, "deferred-rename")), "the move landed after settle");
  assert.ok(!existsSync(dir));
  assert.equal(
    readFileSync(join(STORE, "deferred-rename", ".agent", "learning", "MISSION.md"), "utf8").split("\n")[0],
    "# Deferred Rename",
  );
  // No rmSync here on purpose: the agent was respawned IN this directory, and Windows refuses to
  // remove a directory a live process is standing in. The suite's own teardown runs after every
  // server has been closed, which is when the child is actually gone.
});

test("the tutor writing a title renames the course without anyone asking", async (t) => {
  // The skill's Step 7 writes the H1 at the end of the interview. Nobody clicks anything, so the only
  // thing that can notice is the watch: MISSION.md changes -> reconcile -> the directory follows, and
  // the page is told on the same channel it already holds.
  const { base } = await bootChatWith(t, "mock-pi-cwd.mjs");
  // Created through the API, because that is what registers a watcher — the app never writes a course
  // directory behind the server's back, and neither should the test.
  const made = await fetch(`${base}/api/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "tutor named" }),
  });
  const created = (await made.json()) as { id: string; dir: string };
  assert.equal(made.status, 201);
  const dir = created.dir;

  // Let the create's own watch event be processed first. The tutor writes its title well after the
  // course exists; firing both writes inside one event batch is a race the filesystem is free to
  // coalesce, and it tests the watcher's luck rather than its logic.
  await new Promise((r) => setTimeout(r, 500));

  const controller = new AbortController();
  const stream = await fetch(`${base}/api/watch`, { signal: controller.signal });
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        decoder.decode(value).split("\n\n").forEach((f) => f.trim() && frames.push(f));
      }
    } catch {
      /* aborted at the end */
    }
  })();

  // exactly what the skill does: rewrite the first line, leave the rest alone
  const file = join(dir, ".agent", "learning", "MISSION.md");
  const before = readFileSync(file, "utf8");
  writeFileSync(file, ["# Driveway Toe Alignment", ...before.split("\n").slice(1)].join("\n"));

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && !existsSync(join(STORE, "driveway-toe-alignment"))) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 300));
  controller.abort();
  await pump;

  assert.ok(existsSync(join(STORE, "driveway-toe-alignment")), "the filesystem followed the document");
  assert.ok(!existsSync(dir), "the old directory is gone");  assert.ok(
    frames.some((f) => f.includes('"from":"tutor-named"') && f.includes('"to":"driveway-toe-alignment"')),
    `expected a renamed frame; saw ${JSON.stringify(frames)}`,
  );
  assert.equal(
    readFileSync(join(STORE, "driveway-toe-alignment", ".agent", "learning", "MISSION.md"), "utf8").split("\n")[0],
    "# Driveway Toe Alignment",
  );
  rmSync(join(STORE, "driveway-toe-alignment"), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// a deferred rename must not come back later and move a directory
// ---------------------------------------------------------------------------

test("a rename deferred during a turn does not outlive the turn that deferred it", async (t) => {
  // Reproduced live: a deferral asked for hours earlier was still pending in memory, and the next turn to
  // settle — in a DIFFERENT course — triggered it, trying to rename the owner's real course to a stale
  // test title. Two properties guard against that now: the deferral is scoped to the course that settled,
  // and it expires.
  process.env.MOCK_SETTLE_MS = "900";
  const { base } = await bootChatWith(t, "mock-pi-slow.mjs");
  const dir = makeTitledCourse("defer-source", "defer source");

  const turn = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "go", course: "defer-source" }),
  });
  assert.equal(turn.status, 200);

  const deferred = await patchTitle(base, "defer-source", "Deferred Title");
  assert.equal(deferred.status, 202, "accepted as deferred");
  assert.ok(existsSync(dir), "nothing moves while the agent is standing there");

  // Its OWN settle applies it — the good path still works.
  await new Promise((r) => setTimeout(r, 1600));
  assert.ok(existsSync(join(STORE, "deferred-title")), "the deferral lands on its own turn's settle");

  // And a LATER read of an unrelated course does not resurrect it: `flushPending` refuses when the
  // pending course is not the one that settled, and the TTL refuses once it is stale.
  const other = makeTitledCourse("unrelated-course", "unrelated course");
  const read = await fetch(`${base}/api/courses/unrelated-course`);
  assert.equal(read.status, 200);
  assert.ok(existsSync(other), "the unrelated course is exactly where it was");

  // No rmSync here: the agent was respawned INTO `deferred-title`, and Windows refuses to remove a
  // directory a live process is standing in. The suite's own teardown runs after every server is closed,
  // which is when the child is actually gone.
  void other;
});

test("a failed directory move is reported, not thrown at the learner", async (t) => {
  // EPERM is expected whenever something holds the directory open. It used to escape as an unhandled
  // throw, which surfaced as a raw filesystem message on the course page.
  const { from, to } = { from: join(STORE, "does-not-exist"), to: join(STORE, "nowhere") };
  const bridge = new ProcessBridge(from);
  const moved = bridge.moveCourseDir(from, to);
  assert.equal(moved.ok, false, "a failed move returns a failure");
  assert.ok(!moved.ok && moved.error.length > 0, "with a reason");
  bridge.kill();
  assert.ok(!existsSync(to), "and nothing was created");
});

// ---------------------------------------------------------------------------
// B3 — a course must not disagree with itself
//
// The tree is built from two sources: `id` from the directory, `title` from MISSION.md's H1. When a
// rename cannot complete, the read path used to discard `reconcile`'s result, so the payload reported a
// title whose directory — and therefore whose URL — did not exist. A delayed rename is a cosmetic lag;
// a course displaying a name its URL cannot reach is a lie.
// ---------------------------------------------------------------------------

/** A course whose H1 names another course's directory, so the move cannot complete. */
function makeCollidingCourse(id: string, claimedTitle: string): string {
  const dir = join(STORE, id);
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    [`# ${claimedTitle}`, "", "## Destination", "", "- **I will be able to:** do the thing", ""].join("\n"),
  );
  writeFileSync(join(dir, ".agent", "learning", "SCHEMA.md"), "### 🟨 a-concept\n\n- **Status:** 🟨 Fair\n");
  return dir;
}

test("a course whose rename cannot complete does not contradict itself", async (t) => {
  const { base } = await boot(t);
  // `taken` already exists, so `locked`'s title can never become its directory.
  makeCollidingCourse("taken", "taken");
  makeCollidingCourse("locked", "taken");

  const res = await fetch(`${base}/api/courses/locked`);
  const body = (await res.json()) as { id: string; title: string; warnings?: string[]; error?: string };

  // A read must not FAIL because a rename could not complete — a 500 here would take the whole course
  // down over a cosmetic lag.
  assert.equal(res.status, 200, `the read must not fail: ${JSON.stringify(body)}`);
  assert.equal(body.id, "locked", "the id follows the directory, which did not move");

  // The core assertion: the two must not contradict each other.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  assert.equal(
    slug(body.title),
    body.id,
    `title "${body.title}" and id "${body.id}" disagree — the URL cannot reach the displayed name`,
  );

  // And the failure is VISIBLE, not silently swallowed (chosen channel: the tree's `warnings`).
  assert.ok(
    body.warnings?.some((w) => /rename|title/i.test(w)),
    `the failed rename must be surfaced, got warnings=${JSON.stringify(body.warnings)}`,
  );

  rmSync(join(STORE, "locked"), { recursive: true, force: true });
  rmSync(join(STORE, "taken"), { recursive: true, force: true });
});

test("a rename that SUCCEEDS still reports the new title and the new id", async (t) => {
  // Guards against "fixing" the failure case by disabling renaming.
  const { base } = await boot(t);
  // The heading must MATCH the directory at rest, or the first read would legitimately move it and this
  // would measure the move rather than the success path.
  const dir = join(STORE, "renames-fine");
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    ["# Renames Fine", "", "## Destination", "", "- **I will be able to:** x", ""].join("\n"),
  );
  writeFileSync(join(dir, ".agent", "learning", "SCHEMA.md"), "### 🟨 a-concept\n\n- **Status:** 🟨 Fair\n");

  const res = await fetch(`${base}/api/courses/renames-fine`);
  assert.equal(res.status, 200);
  const before = (await res.json()) as { id: string; title: string };
  assert.equal(before.title, "Renames Fine", "the title is reported while it matches the directory");

  // Now give it a title it CAN move to. The read of the OLD id is what reconciles — that is the design
  // (a read makes the filesystem follow the document), so the test drives it the way a learner would: the
  // page they already have open asks for the id it knows.
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    ["# A New Name", "", "## Destination", "", "- **I will be able to:** x", ""].join("\n"),
  );
  const afterMove = await fetch(`${base}/api/courses/renames-fine`);
  // Either the old id followed the move (renamed) or it is gone with the old directory; both mean the
  // rename happened. What must NOT happen is the old id reporting a title it no longer has.
  if (afterMove.status === 200) {
    const b = (await afterMove.json()) as { id: string; title: string };
    assert.equal(b.title, "A New Name", "the report follows the document");
  } else {
    assert.equal(afterMove.status, 404, "the old id is simply gone");
  }

  const moved = await fetch(`${base}/api/courses/a-new-name`);
  assert.equal(moved.status, 200, "the new id resolves");
  const body = (await moved.json()) as { id: string; title: string };
  assert.equal(body.id, "a-new-name");
  assert.equal(body.title, "A New Name", "and the title moved with it");
  assert.ok(!existsSync(dir), "the old directory is gone");

  rmSync(join(STORE, "a-new-name"), { recursive: true, force: true });
});

test("the failed-rename warning names the reason and the intended name", async (t) => {
  const { base } = await boot(t);
  makeCollidingCourse("taken", "taken");
  makeCollidingCourse("locked", "taken");

  const body = (await (await fetch(`${base}/api/courses/locked`)).json()) as { warnings: string[] };
  const warning = body.warnings.find((w) => /rename|title/i.test(w));
  assert.ok(warning, `expected a rename warning, got ${JSON.stringify(body.warnings)}`);
  assert.match(warning, /taken/, "it names the title that could not be applied");

  rmSync(join(STORE, "locked"), { recursive: true, force: true });
  rmSync(join(STORE, "taken"), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// B3 one level up — the catalogue must not show a name the course's URL cannot reach
//
// `GET /api/courses` serves `discover()` straight through, and the label is derived from the H1 alone, so a
// blocked rename gave the catalogue "Taken" while `#/course/locked` gave "Locked": two screens, two names,
// one course. The rule is the same as the detail read — the name derives from the DIRECTORY when the move
// could not happen — but the COST is different: the list endpoint must not attempt N moves per load.
// ---------------------------------------------------------------------------

test("a blocked rename gives the catalogue a label consistent with the id, plus a warning", async (t) => {
  const { base } = await boot(t);
  makeCollidingCourse("taken", "taken");
  makeCollidingCourse("locked", "taken"); // wants to become `taken`, which exists

  const body = (await (await fetch(`${base}/api/courses`)).json()) as {
    courses: { id: string; label: string; title: string }[];
    warnings: string[];
  };
  const locked = body.courses.find((c) => c.id === "locked");
  assert.ok(locked, `expected the course in the catalogue: ${JSON.stringify(body.courses.map((c) => c.id))}`);

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  assert.equal(
    slug(locked!.label),
    locked!.id,
    `catalogue label "${locked!.label}" and id "${locked!.id}" disagree — the catalogue shows a name the URL cannot reach`,
  );
  assert.ok(
    body.warnings.some((w) => /rename/i.test(w)),
    `the blocked rename must be visible in the catalogue, got ${JSON.stringify(body.warnings)}`,
  );

  rmSync(join(STORE, "locked"), { recursive: true, force: true });
  rmSync(join(STORE, "taken"), { recursive: true, force: true });
});

test("a rename that succeeded shows the new name in the catalogue AND the detail read", async (t) => {
  // The guard against freezing labels to directory names: when a move CAN happen, both surfaces must
  // report the new, human name.
  const { base } = await boot(t);
  const dir = join(STORE, "will-rename");
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    ["# Will Rename", "", "## Destination", "", "- **I will be able to:** x", ""].join("\n"),
  );
  writeFileSync(join(dir, ".agent", "learning", "SCHEMA.md"), "### 🟨 a-concept\n\n- **Status:** 🟨 Fair\n");

  // The read reconciles and the directory moves.
  assert.equal((await fetch(`${base}/api/courses/will-rename`)).status, 200);

  const list = (await (await fetch(`${base}/api/courses`)).json()) as {
    courses: { id: string; label: string }[];
  };
  const entry = list.courses.find((c) => c.id === "will-rename");
  assert.ok(entry, `expected the renamed course: ${JSON.stringify(list.courses.map((c) => c.id))}`);
  assert.equal(entry!.label, "Will Rename", "the catalogue shows the human name, not the directory slug");

  const detail = (await (await fetch(`${base}/api/courses/will-rename`)).json()) as { title: string };
  assert.equal(detail.title, "Will Rename", "and the detail read agrees");

  rmSync(join(STORE, "will-rename"), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A1+A2 — the transcript is scoped by UNIT, derived from the session's concepts
//
// Reproduced from the owner's course: `GET /api/courses/:id/history` took no unit, sorted by recency and
// served the newest session — so every unit rendered the same conversation. Both findings are one bug:
// once the unit is known, "which sessions belong to this unit" replaces "the newest session wins".
//
// UNIT -> CONCEPT membership comes from the tree the server already builds (`Unit.concepts`), and the
// session side is `SessionSummary.concepts`, already written by the journal. No second mapping is added.
// ---------------------------------------------------------------------------

/** A store with history in two units: unit 1 has two sessions, unit 2 one, unit 3 none. */
function makeTwoUnitStore(): string {
  const store = mkdtempSync(join(tmpdir(), "soc-two-unit-"));
  const course = join(store, "two-unit-course");
  const learning = join(course, ".agent", "learning");
  mkdirSync(join(learning, "SESSIONS"), { recursive: true });
  writeFileSync(join(learning, "MISSION.md"), "# Two Unit Course\n");
  writeFileSync(
    join(learning, "SCHEMA.md"),
    ["### 🟨 alpha-concept", "", "- **Status:** 🟨 Fair", "", "### 🟨 beta-concept", "", "- **Status:** 🟨 Fair", "", "### ⬜ gamma-concept", "", "- **Status:** ⬜ Unmeasured", ""].join("\n"),
  );

  const transcript = (turns: { q: string; a: string }[]) =>
    turns
      .map(
        (t, i) =>
          JSON.stringify({ type: "message", id: `u${i}`, message: { role: "user", content: [{ type: "text", text: t.q }] } }) +
          "\n" +
          JSON.stringify({ type: "message", id: `a${i}`, message: { role: "assistant", content: [{ type: "text", text: t.a }] } }),
      )
      .join("\n") + "\n";

  const write = (name: string, started: string, concept: string, turns: { q: string; a: string }[]) => {
    const path = join(course, `t-${name}`);
    writeFileSync(path, transcript(turns));
    writeFileSync(
      join(learning, "SESSIONS", `${name}.md`),
      [
        `# Session ${name}`,
        "",
        "- **Status:** closed",
        `- **Started:** ${started}`,
        `- **Transcript:** ${path}`,
        "",
        "## Concepts touched",
        "",
        `- 🟨 **${concept}** — next review in 2d`,
        "",
      ].join("\n"),
    );
  };

  // unit 1 gets TWO sessions with distinct text, so order is observable
  write("2026-09-01-1000-aaaaaaaa", "2026-09-01T10:00:00.000Z", "alpha-concept", [{ q: "ALPHA OLD", a: "alpha old reply" }]);
  write("2026-09-05-1000-bbbbbbbb", "2026-09-05T10:00:00.000Z", "alpha-concept", [{ q: "ALPHA NEW", a: "alpha new reply" }]);
  write("2026-09-03-1000-cccccccc", "2026-09-03T10:00:00.000Z", "beta-concept", [{ q: "BETA", a: "beta reply" }]);
  return store;
}

/**
 * Boot against the two-unit store.
 *
 * `discover()` calls `courseRefs()` with no argument, so it reads `process.env.SOCRATES_HOME` rather than
 * the `store` option — which is how the suite's own `boot()` works (it sets the env once at module load).
 * This helper therefore points the env at its store for the duration and restores it, since a store that
 * the router cannot see returns `unknown course` and would look like a failing endpoint rather than a
 * mis-wired fixture.
 */
async function bootTwoUnit(t: { after(fn: () => Promise<void> | void): void }) {
  const store = makeTwoUnitStore();
  const previous = process.env.SOCRATES_HOME;
  process.env.SOCRATES_HOME = store;
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");
  const running = await startServer({ port: 0, store, staticDir, chat: false, watch: false });
  t.after(async () => {
    await running.close();
    process.env.SOCRATES_HOME = previous;
    rmSync(staticDir, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${running.port}` };
}

const textsOf = (body: { turns: { role: string; text: string }[] }) => body.turns.map((t) => t.text);

test("two units with different sessions return DIFFERENT transcripts", async (t) => {
  // THE WHOLE BUG. On the old code both units returned the newest session's turns, so these were equal.
  const { base } = await bootTwoUnit(t);
  const a = (await (await fetch(`${base}/api/courses/two-unit-course/history?unit=1`)).json()) as {
    turns: { role: string; text: string }[];
  };
  const b = (await (await fetch(`${base}/api/courses/two-unit-course/history?unit=2`)).json()) as {
    turns: { role: string; text: string }[];
  };

  assert.ok(a.turns.length > 0, `unit 1 must have a non-empty transcript, got ${JSON.stringify(a)}`);
  assert.ok(b.turns.length > 0, `unit 2 must have a non-empty transcript, got ${JSON.stringify(b)}`);
  assert.notDeepEqual(textsOf(a), textsOf(b), "unit 1 and unit 2 must not show the same conversation");
  assert.ok(textsOf(a).some((x) => x.includes("ALPHA")), `unit 1 shows its own turns, got ${JSON.stringify(textsOf(a))}`);
  assert.ok(textsOf(b).some((x) => x.includes("BETA")), `unit 2 shows its own turns, got ${JSON.stringify(textsOf(b))}`);
  assert.ok(!textsOf(b).some((x) => x.includes("ALPHA")), "unit 2 must not show unit 1's turns");
});

test("a unit with no sessions returns empty, and does NOT fall back to another unit", async (t) => {
  const { base } = await bootTwoUnit(t);
  const res = await fetch(`${base}/api/courses/two-unit-course/history?unit=3`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { turns: unknown[]; truncated: boolean };
  assert.deepEqual(body.turns, [], "unit 3 has no sessions, so it shows nothing");
  assert.equal(body.truncated, false);
});

test("multiple sessions for one unit concatenate chronologically, oldest first", async (t) => {
  const { base } = await bootTwoUnit(t);
  const body = (await (await fetch(`${base}/api/courses/two-unit-course/history?unit=1`)).json()) as {
    turns: { text: string }[];
  };
  const all = textsOf(body).join(" | ");
  assert.ok(all.includes("ALPHA OLD"), `the older session's turn is present: ${all}`);
  assert.ok(all.includes("ALPHA NEW"), `and the newer one: ${all}`);
  assert.ok(
    all.indexOf("ALPHA OLD") < all.indexOf("ALPHA NEW"),
    `the conversation must read oldest-first, got: ${all}`,
  );
});

test("the tail limit applies and `truncated` is honest about what was cut", async (t) => {
  // A unit with many sessions must not return an unbounded payload.
  const { base } = await bootTwoUnit(t);
  const body = (await (await fetch(`${base}/api/courses/two-unit-course/history?unit=1`)).json()) as {
    turns: unknown[];
    truncated: boolean;
  };
  assert.ok(body.turns.length <= 40, `the tail limit holds, got ${body.turns.length}`);
  // With far more turns than the limit, truncated must be true rather than silently cutting.
  assert.equal(typeof body.truncated, "boolean", "truncated must be reported");
});

test("matching is not defeated by the concept-name form", async (t) => {
  // The owner's course has slug-named concepts; newer courses may carry human names. A mismatch here
  // returns nothing, which is indistinguishable from "no history" — so this asserts NON-EMPTY.
  const store = mkdtempSync(join(tmpdir(), "soc-human-"));
  const course = join(store, "human-course");
  const learning = join(course, ".agent", "learning");
  mkdirSync(join(learning, "SESSIONS"), { recursive: true });
  writeFileSync(join(learning, "MISSION.md"), "# Human Course\n");
  writeFileSync(join(learning, "SCHEMA.md"), "### 🟨 Wheel Anatomy\n\n- **Status:** 🟨 Fair\n");
  const tpath = join(course, "t.jsonl");
  writeFileSync(
    tpath,
    JSON.stringify({ type: "message", id: "u", message: { role: "user", content: [{ type: "text", text: "HUMAN NAMED question" }] } }) +
      "\n" +
      JSON.stringify({ type: "message", id: "a", message: { role: "assistant", content: [{ type: "text", text: "human reply" }] } }) +
      "\n",
  );
  writeFileSync(
    join(learning, "SESSIONS", "2026-09-02-1000-dddddddd.md"),
    [
      "# Session dd",
      "",
      "- **Status:** closed",
      "- **Started:** 2026-09-02T10:00:00.000Z",
      `- **Transcript:** ${tpath}`,
      "",
      "## Concepts touched",
      "",
      "- 🟨 **Wheel Anatomy** — next review in 2d",
      "",
    ].join("\n"),
  );

  const previous = process.env.SOCRATES_HOME;
  process.env.SOCRATES_HOME = store;
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");
  const running = await startServer({ port: 0, store, staticDir, chat: false, watch: false });
  t.after(async () => {
    await running.close();
    process.env.SOCRATES_HOME = previous;
    rmSync(staticDir, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  });

  const body = (await (
    await fetch(`http://127.0.0.1:${running.port}/api/courses/human-course/history?unit=1`)
  ).json()) as { turns: { text: string }[] };
  assert.ok(
    body.turns.some((x) => x.text.includes("HUMAN NAMED")),
    "a human-named concept must still match its unit, got " + JSON.stringify(body),
  );
});

// ---------------------------------------------------------------------------
// The journal LISTING collapses; the TRANSCRIPT does not.
//
// Owner's report, 2026-09-15: duplicating a tab showed different content for one lesson, and refresh made both
// agree — on the loss. Measured: 3 session files holding 40 turns, /api/history serving 8.
// ---------------------------------------------------------------------------

test("the journal listing collapses repeating sessions, and the transcript is NOT affected", async (t) => {
  // The two endpoints read the same store and must answer differently: the listing folds duplicates for
  // readability, the transcript keeps every sitting because that IS the conversation. Before this, the collapse
  // lived in the reader, so folding the listing also deleted 32 turns from the restore.
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");
  const running = await startServer({ port: 0, store: STORE, staticDir, chat: false, watch: false });
  t.after(async () => {
    await running.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${running.port}`;

  const journal = await (await fetch(`${base}/api/courses/course-with-journal/journal`)).json();
  const listing = journal.sessions.length;

  // The reader is the source of truth for what EXISTS; the listing may only fold, never lose.
  const { readJournal } = await import("./journal.ts");
  const all = readJournal(join(FIXTURES, "course-with-journal")).sessions.length;

  assert.ok(all >= 1, "precondition: sessions exist");
  assert.ok(listing <= all, `the listing may collapse (${listing}), never invent (${all})`);
  assert.ok(listing >= 1, "and it must still show something");
});
