/**
 * fs-browse.test.ts — the folder browser's guards.
 *
 * The endpoint lists DIRECTORY NAMES, so the tests pin what it must never do as much as what it does:
 * no file names, no contents, and a readable refusal for anything that is not a directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browse, parentOf, roots } from "./fs-browse.ts";

function tmp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "fsbrowse-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeCourse(root: string, name: string, initiated: boolean): string {
  const dir = join(root, name);
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  if (initiated) writeFileSync(join(dir, ".agent", "learning", "MISSION.md"), "# Mission\n");
  return dir;
}

test("listing returns DIRECTORIES ONLY — never file names", (t) => {
  const root = tmp(t);
  mkdirSync(join(root, "a-folder"));
  writeFileSync(join(root, "a-file.txt"), "secret contents");
  writeFileSync(join(root, "another.md"), "# not yours to list");

  const result = browse(root);
  assert.deepEqual(result.entries.map((e) => e.name), ["a-folder"]);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("a-file.txt"), false, "a file name must not appear in the payload");
  assert.equal(serialised.includes("secret contents"), false, "and certainly not its contents");
  assert.equal(serialised.includes("another.md"), false);
});

test("a directory that is a course is flagged, and one that was started is flagged further", (t) => {
  const root = tmp(t);
  makeCourse(root, "started", true);
  makeCourse(root, "bare", false);
  mkdirSync(join(root, "plain"));

  const byName = Object.fromEntries(browse(root).entries.map((e) => [e.name, e]));
  assert.deepEqual(
    [byName.started.isCourse, byName.started.initiated],
    [true, true],
    "a course with a mission",
  );
  assert.deepEqual([byName.bare.isCourse, byName.bare.initiated], [true, false], "a learning dir, no mission");
  assert.deepEqual([byName.plain.isCourse, byName.plain.initiated], [false, false], "an ordinary folder");
});

test("courses sort first, because choosing one is the point", (t) => {
  const root = tmp(t);
  mkdirSync(join(root, "aaa-plain"));
  makeCourse(root, "zzz-course", true);
  mkdirSync(join(root, "mmm-plain"));

  assert.deepEqual(browse(root).entries.map((e) => e.name), ["zzz-course", "aaa-plain", "mmm-plain"]);
});

test("parentOf walks up and stops at the top", (t) => {
  const root = tmp(t);
  const child = join(root, "child");
  mkdirSync(child);
  assert.equal(parentOf(child), root, "one level up");
  assert.equal(parentOf(join(child, "..", "child")), root, "a path with .. is resolved first");
  const drive = roots()[0];
  assert.equal(parentOf(drive), null, `nothing above ${drive}`);
});

test("the roots listing is offered when no path is given", () => {
  const result = browse(null);
  assert.equal(result.path, null);
  assert.equal(result.parent, null);
  assert.ok(result.entries.length >= 1);
  assert.deepEqual(result.entries.map((e) => e.path), roots());
  assert.ok(result.entries.every((e) => e.isCourse === false), "a drive root is not itself a course");
});

test("a missing or non-directory path is refused with a readable reason", (t) => {
  const root = tmp(t);
  const file = join(root, "a-file.txt");
  writeFileSync(file, "x");

  assert.throws(() => browse(join(root, "does-not-exist")), /no such directory/);
  assert.throws(() => browse(file), /not a directory/);
});

test("a listing reports where it is and what is above it, so the UI can navigate", (t) => {
  const root = tmp(t);
  mkdirSync(join(root, "inner"));
  const result = browse(join(root, "inner"));
  assert.equal(result.path, join(root, "inner"));
  assert.equal(result.parent, root);
});
