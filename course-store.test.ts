/**
 * course-store.test.ts — the single store, and starting a course from a subject.
 *
 * Every test points SOCRATES_HOME at a temp directory, so nothing here reads or writes a real store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { courseDir, createCourse, learningDir, listCourses, slugifySubject, storeRoot } from "./course-store.ts";

function env(t: { after(fn: () => void): void }): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), "socrates-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { ...process.env, SOCRATES_HOME: home } as NodeJS.ProcessEnv;
}

test("the store is one directory, overridable so tests never touch a real one", (t) => {
  const e = env(t);
  assert.equal(storeRoot(e), e.SOCRATES_HOME);
  assert.ok(storeRoot(e).includes("socrates-home-"), "a temp store");
  assert.ok(storeRoot({} as NodeJS.ProcessEnv).endsWith(join(".socrates", "courses")), "the default is a home dir");
});

test("a subject becomes a slug, and slugs are safe directory names", () => {
  assert.equal(slugifySubject("Supabase RLS"), "supabase-rls");
  assert.equal(slugifySubject("  React: hooks & effects!  "), "react-hooks-effects");
  assert.equal(slugifySubject("C++ / Rust??"), "c-rust");
  assert.equal(slugifySubject("Ünïcödé"), "n-c-d", "non-ascii is stripped rather than mangled into the path");
  assert.equal(slugifySubject("!!!"), "", "nothing usable");
  assert.equal(slugifySubject("x".repeat(200)).length <= 64, true, "bounded length");
  assert.equal(slugifySubject("a-".repeat(80)).endsWith("-"), false, "never ends in a separator");
});

test("starting a course creates the store layout and seeds the mission", (t) => {
  const e = env(t);
  const result = createCourse("Supabase RLS", e);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.id, "supabase-rls");
  assert.equal(result.dir, courseDir("supabase-rls", e));
  assert.ok(existsSync(join(learningDir(result.dir), "MISSION.md")), "the marker that makes it a course");

  const mission = readFileSync(join(learningDir(result.dir), "MISSION.md"), "utf8");
  assert.match(mission, /I will be able to:\*\* Supabase RLS/, "the learner's own words, unedited");
  assert.match(mission, /<pending the interview>/, "fields the tutor has not asked about are marked, not invented");
  assert.doesNotMatch(mission, /rlspolicies|SupabaseRLS/, "the subject is not mangled into the mission text");
});

test("a started course lists immediately, with the subject as its title", (t) => {
  const e = env(t);
  createCourse("Supabase RLS", e);
  const courses = listCourses(e);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].id, "supabase-rls");
  assert.equal(courses[0].title, "Supabase RLS");
  assert.equal(courses[0].concepts, 0, "no concept cards until the tutor scaffolds it");
  assert.deepEqual(courses[0].sessions, { count: 0, lastAt: null });
});

test("starting the same subject twice is refused rather than overwritten", (t) => {
  const e = env(t);
  assert.equal(createCourse("Supabase RLS", e).ok, true);
  const again = createCourse("Supabase RLS", e);
  assert.equal(again.ok, false);
  if (!again.ok) assert.match(again.error, /already exists/);
});

test("an empty or unusable subject is refused", (t) => {
  const e = env(t);
  assert.match((createCourse("   ", e) as { error: string }).error, /subject is required/);
  assert.match((createCourse("!!!", e) as { error: string }).error, /no usable letters or digits/);
  assert.deepEqual(listCourses(e), [], "nothing was created");
});

test("courses whose subjects differ only in punctuation collide, and that is refused loudly", (t) => {
  const e = env(t);
  assert.equal(createCourse("React Hooks", e).ok, true);
  // Same slug, so the second is refused instead of silently landing in the first course's directory.
  const clash = createCourse("react-hooks", e);
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.match(clash.error, /already exists/);
});

test("an unreadable course still lists, by its directory name", (t) => {
  const e = env(t);
  const dir = courseDir("broken", e);
  mkdirSync(learningDir(dir), { recursive: true });
  writeFileSync(join(learningDir(dir), "MISSION.md"), "# no destination line here\n");

  const courses = listCourses(e);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].title, "broken", "falls back to the directory name rather than throwing");
});

test("a directory without a learning folder is not a course", (t) => {
  const e = env(t);
  mkdirSync(join(storeRoot(e), "not-a-course"), { recursive: true });
  assert.deepEqual(listCourses(e), []);
});

test("a missing store lists nothing rather than failing", (t) => {
  const e = env(t);
  assert.deepEqual(listCourses(e), []);
});
