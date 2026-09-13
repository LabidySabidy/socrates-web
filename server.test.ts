/**
 * server.test.ts — T-014: the multi-course API surface, plus the byte-compatibility
 * guarantee on the legacy /api/learning alias.
 *
 * Boots the real router on an ephemeral port against vendored fixtures. `chat: false`
 * because the chat routes spawn pi and are covered separately by bridge.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "./server.ts";
import { parseLearning } from "./learning-parser.ts";

const FIXTURES = join(import.meta.dirname, "test", "fixtures");
const BASIC = join(FIXTURES, "course-basic");

async function boot(t: { after(fn: () => Promise<void> | void): void }): Promise<{ base: string; running: RunningServer }> {
  // A throwaway static root keeps the tests independent of `web/dist` existing.
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>\n");
  const running = await startServer({
    port: 0,
    projectDir: BASIC,
    coursesRoot: FIXTURES,
    registryPath: join(BASIC, ".agent", "courses.json"),
    staticDir,
    chat: false,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(join(BASIC, ".agent", "courses.json"), { force: true });
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
  // cwd = PROJECT_DIR; the global learning + telemetry extensions then wrote an event log
  // containing absolute paths straight into the course directory. Booting is now inert:
  // the bridge is wired on the first chat request only.
  const before = walk(BASIC);
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>\n");
  const running = await startServer({
    port: 0,
    projectDir: BASIC,
    coursesRoot: FIXTURES,
    registryPath: join(BASIC, ".agent", "courses.json"),
    staticDir,
    chat: true, // chat available — just not started
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(join(BASIC, ".agent", "courses.json"), { force: true });
    rmSync(staticDir, { recursive: true, force: true });
  });

  await new Promise((r) => setTimeout(r, 500)); // give an unwanted spawn time to write
  assert.deepEqual(walk(BASIC), before, "booting must not touch the course directory");
  assert.ok(!before.some((f) => f.includes("events.jsonl") || f.includes("telemetry") || f.includes("SESSIONS")));
});

test("GET /api/courses lists discovered courses with their metadata", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses`);

  assert.equal(status, 200);
  assert.deepEqual(body.warnings, []);
  assert.equal(body.root, FIXTURES);

  const ids = body.courses.map((c: { id: string }) => c.id);
  for (const expected of [
    "course-basic",
    "course-empty-concepts",
    "course-no-schema",
    "course-manifest",
  ]) {
    assert.ok(ids.includes(expected), `expected ${expected} in ${ids.join()}`);
  }

  const basic = body.courses.find((c: { id: string }) => c.id === "course-basic");
  assert.equal(basic.concepts, 3);
  assert.equal(basic.kind, "topic");
  assert.equal(basic.label, "derive a course tree from learning markdown without inventing data");
  assert.equal(basic.hidden, false);
  assert.equal(basic.fromScan, true);
  assert.equal(basic.fromRegistry, false);

  const manifest = body.courses.find((c: { id: string }) => c.id === "course-manifest");
  assert.equal(manifest.kind, "codebase");
});

test("discovery marks a learning folder without MISSION.md as not initiated", async (t) => {
  const { base } = await boot(t);
  const { body } = await getJson(`${base}/api/courses`);

  const bare = body.courses.find((c: { id: string }) => c.id === "course-no-mission");
  assert.equal(bare.initiated, false, "no MISSION.md means the user never started it");
  assert.ok(bare.dir, "it is still reported so the UI can explain why it is hidden");

  const real = body.courses.find((c: { id: string }) => c.id === "course-basic");
  assert.equal(real.initiated, true);
  // every other fixture carries a mission
  const uninitiated = body.courses.filter((c: { initiated: boolean }) => !c.initiated);
  assert.deepEqual(uninitiated.map((c: { id: string }) => c.id), ["course-no-mission"]);
});

test("a not-initiated course is still loadable — only discovery excludes it", async (t) => {
  const { base } = await boot(t);
  const { status, body } = await getJson(`${base}/api/courses/course-no-mission`);
  assert.equal(status, 200);
  assert.ok(body.warnings.includes("no-mission"), "the derivation stays graceful");
  assert.equal(body.units.length, 1);
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

test("POST /api/courses registers, hides, and unregisters — touching only the registry", async (t) => {
  const { base } = await boot(t);
  const outside = mkdtempSync(join(tmpdir(), "soc-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(outside, "Outside", ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(outside, "Outside", ".agent", "learning", "MISSION.md"),
    "# M\n\n- **I will be able to:** live outside the scan root\n",
  );
  const outsideDir = join(outside, "Outside");

  const post = async (payload: unknown) => {
    const res = await fetch(`${base}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  };

  const registered = await post({ dir: outsideDir, label: "Outside (labelled)", order: 0 });
  assert.equal(registered.status, 200);
  assert.equal(registered.body.ok, true);
  const added = registered.body.courses.find((c: { id: string }) => c.id === "Outside");
  assert.equal(added.label, "Outside (labelled)");
  assert.equal(added.fromScan, false);
  assert.equal(added.fromRegistry, true);
  assert.equal(registered.body.courses[0].id, "Outside", "order 0 pins it first");

  const hidden = await post({ dir: outsideDir, action: "hide" });
  assert.equal(hidden.body.courses.find((c: { id: string }) => c.id === "Outside").hidden, true);

  const unhidden = await post({ dir: outsideDir, action: "unhide" });
  assert.equal(unhidden.body.courses.find((c: { id: string }) => c.id === "Outside").hidden, false);

  const unregistered = await post({ dir: outsideDir, action: "unregister" });
  assert.equal(unregistered.body.ok, true);
  assert.ok(!unregistered.body.courses.some((c: { id: string }) => c.id === "Outside"));
  assert.equal(unregistered.body.stillDiscovered, undefined, "outside the scan root, so it is really gone");

  // disk is untouched: unregister only edits the registry
  assert.ok(readFileSync(join(outsideDir, ".agent", "learning", "MISSION.md"), "utf8").length > 0);
});

test("unregistering a scanned course says it is still discoverable, and hide is the real removal", async (t) => {
  const { base } = await boot(t);
  const post = async (payload: unknown) => {
    const res = await fetch(`${base}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  };

  const dir = join(FIXTURES, "course-no-mission");
  await post({ dir }); // register it first so there is something to remove
  const removed = await post({ dir, action: "unregister" });
  assert.equal(removed.body.stillDiscovered, true, "the scan re-finds a course under COURSES_ROOT");
  assert.match(removed.body.hint, /hide/);

  const hidden = await post({ dir, action: "hide" });
  // discover() returns hidden courses too, flagged — the UI needs them to offer "unhide".
  assert.equal(hidden.body.courses.find((c: { id: string }) => c.id === "course-no-mission").hidden, true);
  await post({ dir, action: "unhide" });
  const back = await post({ dir, action: "unhide" });
  assert.equal(back.body.courses.find((c: { id: string }) => c.id === "course-no-mission").hidden, false);
});

test("POST /api/courses rejects a non-course, a missing dir, and an unknown action", async (t) => {
  const { base } = await boot(t);
  const post = async (payload: unknown) => {
    const res = await fetch(`${base}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  };

  const missing = await post({});
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /dir required/);

  const notACourse = await post({ dir: mkdtempSync(join(tmpdir(), "soc-plain-")) });
  assert.equal(notACourse.status, 400);
  assert.match(notACourse.body.error, /not a course directory/);

  const badAction = await post({ dir: BASIC, action: "explode" });
  assert.equal(badAction.status, 400);
  assert.match(badAction.body.error, /unknown action/);
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

test("the catalogue reports session recency from file names alone", async (t) => {
  const { base } = await boot(t);
  const { body } = await getJson(`${base}/api/courses`);
  const journalCourse = body.courses.find((c: { id: string }) => c.id === "course-with-journal");
  assert.deepEqual(journalCourse.sessions, { count: 2, lastAt: "2026-09-10T07:41:00.000Z" });

  const plain = body.courses.find((c: { id: string }) => c.id === "course-basic");
  assert.deepEqual(plain.sessions, { count: 0, lastAt: null });
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
async function bootChat(t: { after(fn: () => Promise<void> | void): void }) {
  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(import.meta.dirname, "test", "mock-pi-cwd.mjs");
  const staticDir = mkdtempSync(join(tmpdir(), "soc-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>ui</title>");
  const running = await startServer({
    port: 0,
    projectDir: BASIC,
    coursesRoot: FIXTURES,
    registryPath: join(BASIC, ".agent", "courses.json"),
    staticDir,
    chat: true,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(join(BASIC, ".agent", "courses.json"), { force: true });
    rmSync(staticDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${running.port}` };
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

test("a prompt without a course keeps the default-course behaviour", async (t) => {
  const { base } = await bootChat(t);
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "where am I" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.equal(body.course, "course-basic");
  assert.equal(body.switched, false, "already in the default course");

  const { lines } = await readStream(`${base}/api/stream`);
  const delta = lines.find((l) => l.includes("cwd:"));
  assert.ok(delta, "a turn streamed back");
  assert.match(JSON.parse(delta!).assistantMessageEvent.delta, /course-basic$/);
});

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

test("a prompt for an unknown or uninitiated course is refused", async (t) => {
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

  const uninitiated = await post("course-no-mission");
  assert.equal(uninitiated.status, 409);
  assert.match(uninitiated.body.error, /not initiated/);
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

  const line = readFileSync(logPath, "utf8").trim().split(String.fromCharCode(10)).at(-1)!;
  const event = JSON.parse(line);
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
  assert.equal(body.events.count, 1, "the attempt is a well-formed event");
  assert.equal(body.events.malformed, 0, "not counted as malformed");
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
  assert.deepEqual(slider.cites, ["src/slope.ts#L2"]);

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
    projectDir: BASIC,
    coursesRoot: FIXTURES,
    registryPath: join(BASIC, ".agent", "courses.json"),
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
