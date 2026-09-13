/**
 * courses.test.ts — T-013: scan-first discovery + registry overlay.
 *
 * Every test builds its own throwaway root, so nothing depends on an external project.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  catalogueCourses,
  defaultCoursesRoot,
  discoverCourses,
  findCourse,
  isCourseDir,
  loadRegistry,
  registerCourse,
  registryPathFor,
  saveRegistry,
  setHidden,
  uninitiatedCourses,
  unregisterCourse,
  visibleCourses,
} from "./courses.ts";

const BADGES = ["⬜", "🟥", "🟨", "🟩", "🟦"];

function makeCourse(
  root: string,
  name: string,
  opts: { destination?: string; concepts?: string[]; manifest?: string } = {},
): string {
  const dir = join(root, name);
  const ld = join(dir, ".agent", "learning");
  mkdirSync(ld, { recursive: true });
  writeFileSync(join(ld, "MISSION.md"), `# Mission\n\n- **I will be able to:** ${opts.destination ?? name}\n`);
  const cards = (opts.concepts ?? [])
    .map((c, i) => `### ${BADGES[i % BADGES.length]} ${c}\n\n- **Status:** ${BADGES[i % BADGES.length]} X\n`)
    .join("\n");
  writeFileSync(join(ld, "SCHEMA.md"), `# SCHEMA\n\n${cards}\n`);
  if (opts.manifest) writeFileSync(join(ld, "COURSE.md"), opts.manifest);
  return dir;
}

function tmp(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), "courses-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("scans one level deep, skips non-courses, and honours the ignore list", (t) => {
  const root = tmp(t);
  makeCourse(root, "Alpha", { concepts: ["a-one", "a-two"] });
  makeCourse(root, "Beta", { concepts: ["b-one"] });
  mkdirSync(join(root, "NotACourse", "src"), { recursive: true });

  const registryPath = join(root, "courses.json");
  let result = discoverCourses({ root, registryPath });
  assert.deepEqual(result.courses.map((c) => c.id).sort(), ["Alpha", "Beta"]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.courses.find((c) => c.id === "Alpha")?.concepts, 2);
  assert.equal(result.courses.find((c) => c.id === "Beta")?.concepts, 1);

  saveRegistry(registryPath, { version: 1, ignore: ["Beta"], courses: [] });
  result = discoverCourses({ root, registryPath });
  assert.deepEqual(result.courses.map((c) => c.id), ["Alpha"]);
});

test("it does not recurse deeper than one level", (t) => {
  const root = tmp(t);
  makeCourse(root, "Nested/Deep", { concepts: ["x"] }); // two levels below root

  // `root/Nested` is not itself a course, so the scan stops and finds nothing.
  assert.deepEqual(
    discoverCourses({ root, registryPath: join(root, "courses.json") }).courses.map((c) => c.id),
    [],
  );
  // Pointing at the next level down does find it, which is the documented bound.
  assert.deepEqual(
    discoverCourses({ root: join(root, "Nested"), registryPath: join(root, "courses.json") }).courses.map(
      (c) => c.id,
    ),
    ["Deep"],
  );
});

test("registry label, order, and hidden overlay the scan", (t) => {
  const root = tmp(t);
  const alpha = makeCourse(root, "Alpha", { destination: "learn alpha", concepts: ["a"] });
  const beta = makeCourse(root, "Beta", { destination: "learn beta", concepts: ["b"] });
  const registryPath = join(root, "courses.json");
  saveRegistry(registryPath, {
    version: 1,
    ignore: [],
    courses: [
      { dir: alpha, label: "Alpha (pinned)", order: 1 },
      { dir: beta, label: "Beta", order: 2, hidden: true },
    ],
  });

  const result = discoverCourses({ root, registryPath });
  const a = findCourse(result, "Alpha")!;
  assert.equal(a.label, "Alpha (pinned)");
  assert.equal(a.title, "learn alpha", "mission destination is kept separately from the label");
  assert.equal(a.fromScan, true);
  assert.equal(a.fromRegistry, true);
  assert.deepEqual(result.courses.map((c) => c.id), ["Alpha", "Beta"], "order is honoured");
  assert.deepEqual(visibleCourses(result).map((c) => c.id), ["Alpha"], "hidden is filtered from the catalogue");
});

test("ordered entries sort before unordered ones, then alphabetically", (t) => {
  const root = tmp(t);
  makeCourse(root, "Zeta", { concepts: ["z"] });
  makeCourse(root, "Alpha", { concepts: ["a"] });
  const zeta = join(root, "Zeta");
  const registryPath = join(root, "courses.json");
  saveRegistry(registryPath, { version: 1, ignore: [], courses: [{ dir: zeta, order: 0 }] });

  const result = discoverCourses({ root, registryPath });
  assert.deepEqual(result.courses.map((c) => c.id), ["Zeta", "Alpha"]);
});

test("the registry can add a course that is outside the scan root", (t) => {
  const root = tmp(t);
  const outside = tmp(t);
  makeCourse(root, "Alpha", { concepts: ["a"] });
  const added = makeCourse(outside, "Elsewhere", { destination: "far away", concepts: ["e"] });

  const registryPath = join(root, "courses.json");
  saveRegistry(registryPath, { version: 1, ignore: [], courses: [{ dir: added, label: "Elsewhere" }] });

  const result = discoverCourses({ root, registryPath });
  const else_ = findCourse(result, "Elsewhere")!;
  assert.equal(else_.fromScan, false);
  assert.equal(else_.fromRegistry, true);
  assert.equal(else_.dir, added);
});

test("a registry entry pointing at a non-course warns instead of failing", (t) => {
  const root = tmp(t);
  const registryPath = join(root, "courses.json");
  saveRegistry(registryPath, { version: 1, ignore: [], courses: [{ dir: join(root, "Ghost") }] });

  const result = discoverCourses({ root, registryPath });
  assert.equal(result.courses.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^registry-dir-not-a-course:/);
});

test("a missing scan root and a corrupt registry both degrade with warnings", (t) => {
  const root = tmp(t);
  const missing = discoverCourses({ root: join(root, "nope"), registryPath: join(root, "courses.json") });
  assert.deepEqual(missing.courses, []);
  assert.ok(missing.warnings.includes("courses-root-missing"));

  makeCourse(root, "Alpha", { concepts: ["a"] });
  const badRegistry = join(root, "courses.json");
  writeFileSync(badRegistry, "{ not json");
  const salvaged = discoverCourses({ root, registryPath: badRegistry });
  assert.deepEqual(salvaged.courses.map((c) => c.id), ["Alpha"], "scan still works");
  assert.ok(salvaged.warnings.some((w) => w.startsWith("registry-invalid:")));
});

test("duplicate directory basenames are disambiguated, never silently merged", (t) => {
  const root = tmp(t);
  const one = makeCourse(join(root, "a"), "Dup", { concepts: ["x"] });
  const two = makeCourse(join(root, "b"), "Dup", { concepts: ["y"] });
  const registryPath = join(root, "courses.json");
  // both live two levels down, so both must arrive via the registry
  saveRegistry(registryPath, { version: 1, ignore: [], courses: [{ dir: one }, { dir: two }] });

  const result = discoverCourses({ root, registryPath });
  assert.equal(result.courses.length, 2);
  assert.deepEqual(result.courses.map((c) => c.id).sort(), ["Dup", "Dup-2"]);
  assert.ok(result.warnings.some((w) => w.startsWith("duplicate-course-id:Dup")));
  assert.deepEqual(new Set(result.courses.map((c) => c.dir)), new Set([one, two]));
});

test("the default course itself is discoverable, and its root defaults to the parent", (t) => {
  const root = tmp(t);
  const project = makeCourse(root, "Project", { concepts: ["p"] });
  assert.equal(defaultCoursesRoot(project), root);
  const result = discoverCourses({ projectDir: project, registryPath: join(project, ".agent", "courses.json") });
  assert.deepEqual(result.courses.map((c) => c.id), ["Project"]);
  assert.equal(registryPathFor(project), join(project, ".agent", "courses.json"));
});

test("register / unregister / hide write the registry and leave disk alone", (t) => {
  const root = tmp(t);
  const alpha = makeCourse(root, "Alpha", { concepts: ["a"] });
  const beta = makeCourse(root, "Beta", { concepts: ["b"] });
  const registryPath = join(root, "courses.json");

  assert.deepEqual(registerCourse(registryPath, alpha), { ok: true });
  assert.deepEqual(registerCourse(registryPath, beta), { ok: true });
  assert.equal(loadRegistry(registryPath).registry.courses.length, 2);

  // a registered course is removed from the registry, not from disk
  assert.deepEqual(unregisterCourse(registryPath, beta), { ok: true });
  assert.equal(loadRegistry(registryPath).registry.courses.length, 1);
  assert.equal(isCourseDir(beta), true, "unregister never touches the course itself");

  // a scanned-but-unregistered course is hidden via the ignore list instead
  assert.deepEqual(unregisterCourse(registryPath, beta), { ok: true });
  assert.deepEqual(loadRegistry(registryPath).registry.ignore, ["Beta"]);
  assert.deepEqual(discoverCourses({ root, registryPath }).courses.map((c) => c.id), ["Alpha"]);

  assert.deepEqual(setHidden(registryPath, alpha, true), { ok: true });
  assert.deepEqual(visibleCourses(discoverCourses({ root, registryPath })), []);
});

test("registering a non-course is refused", (t) => {
  const root = tmp(t);
  mkdirSync(join(root, "NotACourse"), { recursive: true });
  const result = registerCourse(join(root, "courses.json"), join(root, "NotACourse"));
  assert.equal(result.ok, false);
  assert.match(result.error!, /not a course directory/);
});

test("the catalogue counts unique concepts, matching the unit count the course page shows", (t) => {
  const root = tmp(t);
  const ld = join(root, "Twin", ".agent", "learning");
  mkdirSync(ld, { recursive: true });
  writeFileSync(join(ld, "MISSION.md"), "# M\n\n- **I will be able to:** twin\n");
  // two cards with the same name: two cards on disk, one derived unit
  writeFileSync(join(ld, "SCHEMA.md"), "# SCHEMA\n\n### 🟨 twin-card\n\n### 🟩 twin-card\n");

  const result = discoverCourses({ root, registryPath: join(root, "courses.json") });
  assert.equal(findCourse(result, "Twin")?.concepts, 1, "two cards, one concept");
});

test("a learning folder without MISSION.md is not an initiated course", (t) => {
  const root = tmp(t);
  makeCourse(root, "Real", { concepts: ["a"] });
  const bare = join(root, "Bare");
  mkdirSync(join(bare, ".agent", "learning"), { recursive: true });
  writeFileSync(join(bare, ".agent", "learning", "SCHEMA.md"), "# SCHEMA\n\n### \u2b1c x\n");

  const result = discoverCourses({ root, registryPath: join(root, "courses.json") });

  assert.equal(result.courses.length, 2, "the bare directory is still reported, never dropped");
  assert.equal(findCourse(result, "Real")?.initiated, true);
  assert.equal(findCourse(result, "Bare")?.initiated, false);

  assert.deepEqual(catalogueCourses(result).map((c) => c.id), ["Real"]);
  assert.deepEqual(uninitiatedCourses(result).map((c) => c.id), ["Bare"]);
  assert.deepEqual(
    uninitiatedCourses(result).map((c) => c.dir),
    [bare],
    "the directory is kept so the UI can explain it",
  );
});

test("a hidden initiated course leaves the catalogue but stays uninitiated-free", (t) => {
  const root = tmp(t);
  const alpha = makeCourse(root, "Alpha", { concepts: ["a"] });
  const registryPath = join(root, "courses.json");
  saveRegistry(registryPath, { version: 1, ignore: [], courses: [{ dir: alpha, hidden: true }] });

  const result = discoverCourses({ root, registryPath });
  assert.equal(findCourse(result, "Alpha")?.initiated, true);
  assert.deepEqual(catalogueCourses(result), [], "hidden is excluded from the catalogue");
  assert.deepEqual(uninitiatedCourses(result), [], "but it is not uninitiated");
});

test("a manifest declaring codebase kind is reported as such", (t) => {
  const root = tmp(t);
  makeCourse(root, "Code", { concepts: ["c"], manifest: "```yaml\nkind: codebase\n```\n" });
  makeCourse(root, "Topic", { concepts: ["t"] });
  const result = discoverCourses({ root, registryPath: join(root, "courses.json") });
  assert.equal(findCourse(result, "Code")?.kind, "codebase");
  assert.equal(findCourse(result, "Topic")?.kind, "topic");
});

test("registry round-trips through disk", (t) => {
  const root = tmp(t);
  const registryPath = join(root, "nested", "courses.json");
  const registry = { version: 1, ignore: ["Skip"], courses: [{ dir: join(root, "X"), label: "L", order: 3, hidden: true }] };
  saveRegistry(registryPath, registry);
  assert.deepEqual(loadRegistry(registryPath).registry, registry);
  assert.match(readFileSync(registryPath, "utf8"), /"version": 1/);
  assert.equal(dirname(registryPath), join(root, "nested"), "parent dirs are created");
});
