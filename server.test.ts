/**
 * server.test.ts — T-014: the multi-course API surface, plus the byte-compatibility
 * guarantee on the legacy /api/learning alias.
 *
 * Boots the real router on an ephemeral port against vendored fixtures. `chat: false`
 * because the chat routes spawn pi and are covered separately by bridge.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "./server.ts";
import { parseLearning } from "./learning-parser.ts";

const FIXTURES = join(import.meta.dirname, "test", "fixtures");
const BASIC = join(FIXTURES, "course-basic");

async function boot(t: { after(fn: () => Promise<void> | void): void }): Promise<{ base: string; running: RunningServer }> {
  const running = await startServer({
    port: 0,
    projectDir: BASIC,
    coursesRoot: FIXTURES,
    registryPath: join(BASIC, ".agent", "courses.json"),
    chat: false,
    watch: false,
  });
  t.after(async () => {
    await running.close();
    rmSync(join(BASIC, ".agent", "courses.json"), { force: true });
  });
  return { base: `http://127.0.0.1:${running.port}`, running };
}

const getJson = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
};

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

test("GET /api/learning is unchanged: the default course, byte-compatible", async (t) => {
  const { base } = await boot(t);
  const res = await fetch(`${base}/api/learning`);
  const text = await res.text();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(text, JSON.stringify(parseLearning(BASIC), null, 2), "alias must not drift");
  assert.deepEqual(Object.keys(JSON.parse(text)), ["projectDir", "present", "mission", "plan", "schema"]);
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

  // disk is untouched: unregister only edits the registry
  assert.ok(readFileSync(join(outsideDir, ".agent", "learning", "MISSION.md"), "utf8").length > 0);
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

test("static files are served and path traversal is refused", async (t) => {
  const { base } = await boot(t);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type")!, /text\/html/);

  const traversal = await fetch(`${base}/../../package.json`);
  assert.ok([403, 404].includes(traversal.status), `got ${traversal.status}`);
});

test("the server binds an ephemeral port when asked for 0", async (t) => {
  const running = await startServer({
    port: 0,
    projectDir: BASIC,
    coursesRoot: FIXTURES,
    registryPath: join(BASIC, ".agent", "courses.json"),
    chat: false,
    watch: false,
  });
  t.after(() => running.close());
  assert.ok(running.port > 0);
  assert.equal((await fetch(`http://127.0.0.1:${running.port}/health`)).status, 200);
});
