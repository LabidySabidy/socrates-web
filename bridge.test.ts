import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ProcessBridge } from "./process-bridge.ts";

const here = dirname(fileURLToPath(import.meta.url));

// Point the bridge at the deterministic mock pi.
process.env.PI_BIN = "node";
process.env.PI_ARGS = join(here, "test", "mock-pi.mjs");

test("bridge spawns, streams JSONL lines, and detects settle", async () => {
  const bridge = new ProcessBridge(process.cwd());
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));

  assert.ok(bridge.pid !== undefined, "child spawned");
  assert.ok(bridge.send({ type: "prompt", message: "hello" }), "send accepted");

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !lines.some((l) => l.includes("agent_settled"))) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.ok(lines.some((l) => l.includes('"type":"response"')), "prompt accepted response");
  assert.ok(lines.some((l) => l.includes("text_delta")), "streamed a text delta");
  assert.ok(lines.some((l) => l.includes("agent_settled")), "turn settled");

  bridge.kill();
  assert.equal(bridge.pid, undefined, "child cleared after kill");
});

// ---------------------------------------------------------------------------
// course switching — T-025
// ---------------------------------------------------------------------------

const here2 = dirname(fileURLToPath(import.meta.url));

/** A bridge whose mock pi reports the directory it was started in. */
function cwdBridge(): ProcessBridge {
  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(here2, "test", "mock-pi-cwd.mjs");
  return new ProcessBridge(process.cwd());
}

/** Wait until a line matching the predicate arrives, or give up. */
async function waitFor(lines: string[], match: (l: string) => boolean, ms = 5000): Promise<string | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = lines.find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

const cwdOf = (line: string) => (JSON.parse(line) as { cwd: string }).cwd;

test("switchCourse replaces the process and the agent runs in the new course", async () => {
  const bridge = cwdBridge();
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));

  const first = await waitFor(lines, (l) => l.includes("__cwd__"));
  assert.ok(first, "the first process announced its cwd");
  assert.equal(resolve(cwdOf(first!)), resolve(process.cwd()));
  const pidBefore = bridge.pid;

  const target = join(here2, "test", "fixtures", "course-basic");
  const result = bridge.switchCourse(target);
  assert.equal(result.switched, true);
  assert.equal(resolve(bridge.courseDir), resolve(target));

  // a fresh process must announce the NEW directory, and it must be a different process
  const second = await waitFor(lines, (l) => l.includes("__cwd__") && resolve(cwdOf(l)) === resolve(target));
  assert.ok(second, `expected a re-announced cwd of ${target}; saw ${JSON.stringify(lines)}`);
  assert.notEqual(bridge.pid, pidBefore, "the process was replaced, not reused");
  assert.equal(resolve(cwdOf(second!)), resolve(target));

  // and a prompt is answered from the new directory
  lines.length = 0;
  assert.ok(bridge.send({ type: "prompt", message: "where am I" }));
  const answer = await waitFor(lines, (l) => l.includes("cwd:"));
  assert.ok(answer, "the new process answered");
  // Parse instead of string-matching: the echoed path is JSON-escaped, so comparing the decoded
  // delta avoids writing any backslash literal in this file at all.
  const delta = (JSON.parse(answer!) as { assistantMessageEvent: { delta: string } }).assistantMessageEvent.delta;
  assert.equal(delta, `cwd:${resolve(target)}`, "the answer names the new course");

  bridge.kill();
});

test("switchCourse is a no-op for the current course and does not recycle the process", async () => {
  const bridge = cwdBridge();
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));
  await waitFor(lines, (l) => l.includes("__cwd__"));
  const pid = bridge.pid;

  const result = bridge.switchCourse(process.cwd());
  assert.equal(result.switched, false);
  assert.equal(bridge.pid, pid, "the same process is kept");

  bridge.kill();
});

test("a switched bridge still answers: the old process exiting must not orphan the new one", async () => {
  const bridge = cwdBridge();
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));
  await waitFor(lines, (l) => l.includes("__cwd__"));

  const target = join(here2, "test", "fixtures", "course-with-journal");
  bridge.switchCourse(target);
  await new Promise((r) => setTimeout(r, 400)); // let the old child's exit event land

  assert.ok(bridge.pid !== undefined, "the new process is still referenced");

  lines.length = 0;
  assert.ok(bridge.send({ type: "prompt", message: "ping" }), "send accepted");
  const settled = await waitFor(lines, (l) => l.includes("agent_settled"));
  assert.ok(settled, "the new process completed a turn");

  bridge.kill();
});

// ---------------------------------------------------------------------------
// renaming the ACTIVE course (Windows: a live process's cwd cannot be moved)
// ---------------------------------------------------------------------------

test("moving the active course's directory tears the child down and respawns it in the new one", async () => {
  // The rename has to happen with no process standing in the directory, and the replacement has to
  // come up in the NEW directory — that is the whole reason this goes through the bridge rather than
  // calling renameSync in the server.
  const root = mkdtempSync(join(tmpdir(), "soc-bridge-move-"));
  const from = join(root, "string-alignment");
  mkdirSync(join(from, ".agent", "learning"), { recursive: true });
  const to = join(root, "wheel-alignment-by-string");

  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(here2, "test", "mock-pi-cwd.mjs");
  const bridge = new ProcessBridge(from);
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));

  const first = await waitFor(lines, (l) => l.includes("__cwd__"));
  assert.ok(first, "the child started in the old directory");
  assert.equal(resolve(cwdOf(first!)), resolve(from));
  const pidBefore = bridge.pid;

  lines.length = 0;
  bridge.moveCourseDir(from, to);
  assert.ok(!existsSync(from), "the directory moved with the child out of the way");
  assert.ok(existsSync(to));

  // The same switchCourse path brings the agent back, now standing in the new directory.
  bridge.switchCourse(to);
  const second = await waitFor(lines, (l) => l.includes("__cwd__") && resolve(cwdOf(l)) === resolve(to));
  assert.ok(second, `expected a fresh child in ${to}; saw ${JSON.stringify(lines)}`);
  assert.notEqual(bridge.pid, pidBefore, "the agent was replaced, not left pointing at a dead path");

  bridge.kill();
  rmSync(root, { recursive: true, force: true });
});

test("moveCourseDir is safe when the child is standing somewhere else", async () => {
  // Only the ACTIVE course needs the teardown; moving an inactive one must not recycle the agent.
  const root = mkdtempSync(join(tmpdir(), "soc-bridge-idle-"));
  const active = join(root, "active");
  const other = join(root, "other");
  mkdirSync(join(active, ".agent", "learning"), { recursive: true });
  mkdirSync(join(other, ".agent", "learning"), { recursive: true });

  process.env.PI_BIN = "node";
  process.env.PI_ARGS = join(here2, "test", "mock-pi-cwd.mjs");
  const bridge = new ProcessBridge(active);
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));
  await waitFor(lines, (l) => l.includes("__cwd__"));
  const pidBefore = bridge.pid;

  const moved = join(root, "renamed");
  bridge.moveCourseDir(other, moved);
  assert.ok(existsSync(moved));
  assert.equal(bridge.pid, pidBefore, "an inactive course's rename does not disturb the running agent");

  bridge.kill();
  rmSync(root, { recursive: true, force: true });
});
