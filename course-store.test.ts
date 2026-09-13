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
import {
  courseDir,
  createCourse,
  learningDir,
  listCourses,
  reconcileCourse,
  slugifySubject,
  storeRoot,
  TITLE_MAX,
  validateTitle,
  writeMissionTitle,
} from "./course-store.ts";
import { parseLearning } from "./learning-parser.ts";

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

test("a course with nothing to name it still lists, by its directory name", (t) => {
  const e = env(t);
  const dir = courseDir("broken", e);
  mkdirSync(learningDir(dir), { recursive: true });
  // No H1 and no destination line — the last link of the chain is the directory name.
  writeFileSync(join(learningDir(dir), "MISSION.md"), "nothing usable in here\n");

  const courses = listCourses(e);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].title, "broken", "falls back to the directory name rather than throwing");
});

test("an H1 that is not the destination still names the course", (t) => {
  // The chain is H1 first: the H1 is the name, and the destination is only what it falls back to.
  const e = env(t);
  const dir = courseDir("named", e);
  mkdirSync(learningDir(dir), { recursive: true });
  writeFileSync(
    join(learningDir(dir), "MISSION.md"),
    "# Wheel Alignment by String\n\n## Destination\n\n- **I will be able to:** align my own wheels\n",
  );
  assert.equal(listCourses(e)[0].title, "Wheel Alignment by String");
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

// ---------------------------------------------------------------------------
// the title: seeded, validated, written surgically, and reconciled
// ---------------------------------------------------------------------------

test("the seed writes the subject as the H1, so the skill can tell its title from the learner's", () => {
  // The tutor-conflict rule is a comparison in the skill: it writes the H1 only if that line still
  // equals the seeded subject. That is only decidable if the seed writes the subject verbatim.
  const env = { SOCRATES_HOME: mkdtempSync(join(tmpdir(), "soc-seed-")) };
  const made = createCourse("how do car wheels get aligned", env);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const text = readFileSync(join(made.dir, ".agent", "learning", "MISSION.md"), "utf8");
  assert.equal(text.split("\n")[0], "# how do car wheels get aligned");
  // no legacy "Mission — " prefix any more, and no duplication of the subject
  const data = parseLearning(made.dir);
  assert.equal(data.mission.title, "how do car wheels get aligned");
  assert.equal(data.mission.destination, "how do car wheels get aligned");
  rmSync(env.SOCRATES_HOME, { recursive: true, force: true });
});

test("a title is refused when it is empty, unusable, or too long to slug predictably", () => {
  assert.equal(validateTitle("   ").ok, false);
  assert.equal(validateTitle("").ok, false);
  assert.equal(validateTitle("!!! ???").ok, false);
  const long = validateTitle("x".repeat(TITLE_MAX + 1));
  assert.equal(long.ok, false);
  // The limit is stated rather than silently truncating into a directory name nobody typed.
  assert.match(long.ok === false ? long.error : "", new RegExp(String(TITLE_MAX)));
  assert.equal(validateTitle("  Wheel  Alignment   by String ").ok, true);
  const squeezed = validateTitle("  Wheel  Alignment   by String ");
  assert.equal(squeezed.ok === true ? squeezed.clean : "", "Wheel Alignment by String");
});

test("writing the title touches only the H1 — every other byte of MISSION.md survives", () => {
  const env = { SOCRATES_HOME: mkdtempSync(join(tmpdir(), "soc-surgical-")) };
  const made = createCourse("string alignment", env);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const file = join(made.dir, ".agent", "learning", "MISSION.md");
  const before = readFileSync(file, "utf8");
  // the learner and the tutor have filled the mission in by now
  const filled = before.replace("<pending the interview>", "a wheel I aligned myself");
  writeFileSync(file, filled, "utf8");

  const wrote = writeMissionTitle(made.dir, "Wheel Alignment by String");
  assert.equal(wrote.ok, true);
  const after = readFileSync(file, "utf8");

  assert.equal(after.split("\n")[0], "# Wheel Alignment by String");
  // everything after the heading is byte-for-byte what it was
  assert.equal(after.split("\n").slice(1).join("\n"), filled.split("\n").slice(1).join("\n"));
  assert.ok(after.includes("a wheel I aligned myself"), "the learner's own words are still there");
  rmSync(env.SOCRATES_HOME, { recursive: true, force: true });
});

test("reconcile moves the directory to match the H1, and never rewrites the H1", () => {
  const env = { SOCRATES_HOME: mkdtempSync(join(tmpdir(), "soc-reconcile-")) };
  const made = createCourse("string alignment", env);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const file = join(made.dir, ".agent", "learning", "MISSION.md");

  // nothing to do while the two agree
  const same = reconcileCourse(made.id, env);
  assert.equal(same.ok, true);
  assert.equal(same.ok === true ? same.renamed : null, false);

  // a hand edit is the same shape as a rename: the document is the truth
  writeMissionTitle(made.dir, "Wheel Alignment by String");
  const moved = reconcileCourse(made.id, env);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.renamed, true);
  assert.equal(moved.id, "wheel-alignment-by-string");
  assert.ok(!existsSync(made.dir), "the old directory is gone");
  assert.ok(existsSync(moved.dir), "the new one exists");
  assert.equal(readFileSync(file.replace(made.dir, moved.dir), "utf8").split("\n")[0], "# Wheel Alignment by String");
  rmSync(env.SOCRATES_HOME, { recursive: true, force: true });
});

test("a reconcile that would collide is refused, leaving both courses alone", () => {
  const env = { SOCRATES_HOME: mkdtempSync(join(tmpdir(), "soc-clash-")) };
  const a = createCourse("string alignment", env);
  const b = createCourse("thrust angle", env);
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  // b's title becomes a's directory name
  writeMissionTitle(b.dir, "String Alignment");
  const result = reconcileCourse(b.id, env);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /already exists/);
  assert.ok(existsSync(a.dir), "the course being protected is untouched");
  assert.ok(existsSync(b.dir), "the course that tried to move has not moved");
  assert.equal(parseLearning(b.dir).mission.title, "String Alignment", "its name is still its own");
  rmSync(env.SOCRATES_HOME, { recursive: true, force: true });
});
