/**
 * course-model.test.ts — T-010 (derivation + edge cases), T-011 (manifest override),
 * T-012 (five-state mastery map).
 *
 * Every fixture is vendored under test/fixtures/, so nothing here depends on an external
 * project existing on this machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseLearning } from "./learning-parser.ts";
import { moduleRingLabel, moduleTypeLabel, type ModuleType } from "./web/src/module-types.ts";
import {
  AUTHORED_MODULE_TYPES,
  MASTERY_BY_BADGE,
  MODULE_TYPES,
  MASTERY_STATES,
  aggregateMastery,
  buildCourse,
  countByMastery,
  masteryOf,
  parseCourseManifest,
  scanCardHeadings,
  slug,
  type CourseSource,
  type Mastery,
} from "./course-model.ts";

const FIXTURES = join(import.meta.dirname, "test", "fixtures");

/** A course source built from an arbitrary directory, for tests that author their own files. */
function load2(dir: string): CourseSource {
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const slash = dir.endsWith("/") ? dir : `${dir}/`;
  return {
    id: dir.split(/[\/]/).pop() ?? "tmp",
    dir,
    data: parseLearning(dir),
    schemaText: read(`${slash}.agent/learning/SCHEMA.md`),
    manifestText: read(`${slash}.agent/learning/COURSE.md`),
  };
}

function load(name: string): CourseSource {
  const dir = join(FIXTURES, name);
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const slash = dir.endsWith("/") ? dir : `${dir}/`;
  return {
    id: name,
    dir,
    data: parseLearning(dir),
    schemaText: read(`${slash}.agent/learning/SCHEMA.md`),
    manifestText: read(`${slash}.agent/learning/COURSE.md`),
  };
}

// ---------------------------------------------------------------------------
// T-012 — the five-state mastery map. Six states is never correct.
// ---------------------------------------------------------------------------

test("every badge maps to exactly one of five mastery states, and nothing else exists", () => {
  assert.equal(MASTERY_STATES.length, 5);
  assert.deepEqual(Object.keys(MASTERY_BY_BADGE), ["⬜", "🟥", "🟨", "🟩", "🟦"]);
  assert.deepEqual(
    ["⬜", "🟥", "🟨", "🟩", "🟦"].map((b) => masteryOf(b).state),
    ["Not started", "Attempted", "Familiar", "Proficient", "Mastered"],
  );
  assert.deepEqual(
    Object.values(MASTERY_BY_BADGE).map((m) => m.ring),
    [0, 0.25, 0.5, 0.78, 1],
  );
});

test("an unknown or missing badge reads Not started rather than inventing a sixth state", () => {
  assert.equal(masteryOf("❓").state, "Not started");
  assert.equal(masteryOf(undefined).state, "Not started");
  assert.ok(MASTERY_STATES.includes(masteryOf("❓").state));
});

test("aggregateMastery picks the nearest state and never divides by zero", () => {
  const m = (b: keyof typeof MASTERY_BY_BADGE): Mastery => MASTERY_BY_BADGE[b];
  assert.equal(aggregateMastery([]).state, "Not started");
  assert.equal(aggregateMastery([m("🟦")]).state, "Mastered");
  assert.equal(aggregateMastery([m("🟨"), m("🟨")]).state, "Familiar");
  assert.equal(aggregateMastery([m("🟩"), m("🟩")]).state, "Proficient");
  // mean of 0 and 1 is 0.5 -> Familiar
  assert.equal(aggregateMastery([m("⬜"), m("🟦")]).state, "Familiar");
  assert.deepEqual(countByMastery([m("🟨"), m("🟨"), m("🟦")]), {
    "Not started": 0, Attempted: 0, Familiar: 2, Proficient: 0, Mastered: 1,
  });
});

// ---------------------------------------------------------------------------
// T-010 — derivation
// ---------------------------------------------------------------------------

test("derives one unit per concept card, with derived study modules", () => {
  const course = buildCourse(load("course-basic"));

  assert.equal(course.warnings.length, 0, `unexpected warnings: ${course.warnings}`);
  assert.equal(course.derived, true);
  // The H1 is the name; the goal sentence lives in the mission and is not the title any more.
  assert.equal(course.title, "Course Basic");
  assert.equal(
    course.mission.destination,
    "derive a course tree from learning markdown without inventing data",
  );

  assert.deepEqual(course.units.map((u) => u.title), ["alpha-one", "beta-two", "gamma-three"]);
  assert.deepEqual(course.units.map((u) => u.mastery.state), ["Familiar", "Proficient", "Not started"]);
  assert.deepEqual(course.units.map((u) => u.n), [1, 2, 3]);

  const alpha = course.units[0];
  const types = alpha.groups[0].modules.map((mod) => mod.type);
  assert.deepEqual(types, ["recite", "review", "explain", "misconceptions"]);
  const misc = alpha.groups[0].modules[3];
  assert.equal(misc.count, 2, "MIS-001 duplicated in the registry counts once");
  assert.equal(alpha.concepts.join(), "alpha-one");

  // gamma-three has no misconceptions, so no misconceptions module
  assert.deepEqual(course.units[2].groups[0].modules.map((m) => m.type), ["recite", "review", "explain"]);
});

test("course-level mastery counts and aggregate come from the cards", () => {
  const course = buildCourse(load("course-basic"));
  assert.equal(course.mastery.total, 3);
  assert.deepEqual(course.mastery.counts, {
    "Not started": 1, Attempted: 0, Familiar: 1, Proficient: 1, Mastered: 0,
  });
  // mean ring (0.5 + 0.78 + 0) / 3 = 0.4267 -> nearest is Familiar (0.5)
  assert.equal(course.mastery.aggregate.state, "Familiar");
});

test("missing SCHEMA.md still renders the mission, with a warning", () => {
  const course = buildCourse(load("course-no-schema"));
  assert.ok(course.warnings.includes("no-schema"));
  assert.equal(course.units.length, 0);
  assert.equal(course.title, "Course No Schema", "the H1 names the course");
  assert.equal(course.mission.destination, "still see the mission when SCHEMA.md is absent");
  assert.ok(course.warnings.includes("no-concepts"));
});

test("missing MISSION.md falls back to the directory name, with a warning", () => {
  const course = buildCourse(load("course-no-mission"));
  assert.ok(course.warnings.includes("no-mission"));
  assert.equal(course.title, "course-no-mission");
  assert.equal(course.units.length, 1);
  assert.equal(course.units[0].title, "orphan-concept");
  assert.equal(course.units[0].mastery.state, "Attempted");
});

test("zero concept cards yields an empty unit list, not a broken tree", () => {
  const course = buildCourse(load("course-empty-concepts"));
  assert.equal(course.units.length, 0);
  assert.ok(course.warnings.includes("no-concepts"));
  assert.ok(!course.warnings.includes("no-schema"));
  assert.deepEqual(course.mastery.counts, {
    "Not started": 0, Attempted: 0, Familiar: 0, Proficient: 0, Mastered: 0,
  });
  assert.equal(course.mastery.aggregate.state, "Not started");
});

test("duplicate concept names warn and collapse to the first card", () => {
  const course = buildCourse(load("course-duplicate-concepts"));
  assert.ok(course.warnings.includes("duplicate-concept:twin-card"));
  assert.equal(course.units.length, 1);
  assert.equal(course.units[0].title, "twin-card");
  assert.equal(course.units[0].mastery.state, "Familiar", "the first card is authoritative");
});

test("a heading glyph outside the five-state union warns and is not a concept", () => {
  const course = buildCourse(load("course-unknown-badge"));
  assert.ok(course.warnings.includes("unknown-badge:odd-one"));
  assert.deepEqual(course.units.map((u) => u.title), ["known-one"]);
  assert.equal(course.units[0].mastery.state, "Mastered");
  assert.deepEqual(scanCardHeadings("### ❓ odd\n### 🟦 ok\n"), [
    { token: "❓", name: "odd" },
    { token: "🟦", name: "ok" },
  ]);
});

test("a course directory that does not exist degrades instead of throwing", () => {
  const src = load("does-not-exist-at-all");
  const course = buildCourse(src);
  assert.equal(course.units.length, 0);
  assert.ok(course.warnings.includes("no-schema"));
  assert.ok(course.warnings.includes("no-mission"));
  assert.equal(course.title, "does-not-exist-at-all");
});

// ---------------------------------------------------------------------------
// T-011 — COURSE.md manifest wins over the derivation
// ---------------------------------------------------------------------------

test("a manifest replaces the derived tree and may set the title", () => {
  const course = buildCourse(load("course-manifest"));

  assert.equal(course.derived, false, "manifest is authoritative");
  assert.equal(course.title, "Manifest Override (authored)");
  assert.deepEqual(course.units.map((u) => u.title), ["Authored Unit", "Second Unit"]);
  assert.equal(course.units[0].blurb, "A blurb written by hand, not derived.");
  assert.deepEqual(course.units[0].groups.map((g) => g.title), ["Getting oriented", "Going deeper"]);

  const first = course.units[0].groups[0].modules;
  assert.deepEqual(first.map((m) => m.type), ["article", "recite", "quiz"]);
  assert.equal(first[1].concept, "derived-card", "@ref attaches the concept");
  assert.equal(first[1].mastery?.state, "Familiar");
  assert.equal(first[2].items, 3, "quiz placement is authored");
  assert.deepEqual(course.units[1].groups[0].modules.map((m) => m.type), ["quiz"]);
});

test("a unit's mastery follows from the concepts it references", () => {
  const course = buildCourse(load("course-manifest"));
  assert.equal(course.units[0].mastery.state, "Familiar", "references 🟨 derived-card");
  assert.equal(course.units[1].mastery.state, "Not started", "references nothing real");
});

test("a manifest referencing a nonexistent card warns and keeps the module marked missing", () => {
  const course = buildCourse(load("course-manifest"));
  assert.ok(course.warnings.includes("unknown-lesson:ghost-card"));
  const ghost = course.units[1].groups[0].modules[0];
  assert.equal(ghost.missing, true);
  assert.equal(ghost.concept, "ghost-card", "the dangling reference is preserved, never invented");
  assert.equal(ghost.type, "quiz");
});

test("a malformed manifest falls back to the derivation and says why", () => {
  const src = load("course-basic");
  const withBadManifest: CourseSource = {
    ...src,
    manifestText: "## Unit 1: Broken\n\n- **Module** (`telepathy`) Not a real type\n",
  };
  const course = buildCourse(withBadManifest);
  assert.ok(course.warnings.some((w) => w.startsWith("manifest-invalid:")), course.warnings.join());
  assert.ok(course.warnings.some((w) => w.includes("unknown module type: telepathy")));
  assert.equal(course.derived, true, "derivation is the safe fallback");
  assert.equal(course.units.length, 3);
});

test("a manifest can author every module type, including the four added for the taxonomy", () => {
  const course = buildCourse(load("course-taxonomy"));

  assert.equal(course.derived, false, "the manifest is authoritative");
  assert.deepEqual(course.warnings, []);
  const modules = course.units[0].groups[0].modules;
  assert.deepEqual(
    modules.map((m) => m.type),
    [
      "article",
      "video",
      "practice",
      "quiz",
      "test",
      "course-challenge",
      "primary-source",
      "faq",
      "interact",
      "game",
      "project",
      "ai-activity",
      "recite",
    ],
  );

  for (const type of ["course-challenge", "primary-source", "faq", "ai-activity"]) {
    assert.ok(AUTHORED_MODULE_TYPES.includes(type as never), `${type} is an authored type`);
    assert.ok(MODULE_TYPES.includes(type as never), `${type} is in the taxonomy`);
    const mod = modules.find((m) => m.type === type)!;
    assert.ok(mod, `${type} round-trips from COURSE.md`);
    assert.ok(mod.title.length > 0, `${type} keeps its authored title`);
  }

  // an @concept ref still attaches mastery for a newly added type
  const ai = modules.find((m) => m.type === "ai-activity")!;
  assert.equal(ai.concept, "taxonomy-card");
  assert.equal(ai.mastery?.state, "Familiar");
  assert.equal(ai.missing, undefined);
});

test("authored quiz items obey the same grading rule as generated ones", () => {
  const src = load("course-basic");
  const manifest = [
    "## Unit 1: Rules",
    "",
    "## Quiz: Grading",
    "",
    "- **Q** Which command reads rows?",
    "  - **answer:** select",
    "  - **hint:** one word",
    "  - **step:** select reads",
    "",
    "- **Q** Explain why the policy fails on a second run in your own words.",
    "  - **answer:** The CREATE POLICY statement fails because a policy of that name already exists, so it needs a drop-if-exists guard before it is created again.",
    "  - **hint:** think about what already exists",
    "  - **step:** drop it first",
    "",
    "- **Q** Explain it again, properly declared this time.",
    "  - **mode:** self-check",
    "  - **answer:** The CREATE POLICY statement fails because a policy of that name already exists, so it needs a drop-if-exists guard before it is created again.",
    "  - **hint:** think about what already exists",
    "  - **step:** drop it first",
    "",
  ].join(String.fromCharCode(10));

  const course = buildCourse({ ...src, manifestText: manifest });

  assert.equal(course.derived, false);
  const quizzes = course.quizzes;
  assert.equal(quizzes.length, 1);
  assert.deepEqual(
    quizzes[0].items.map((i) => i.mode),
    ["short-answer", "self-check"],
    "the long item without a mode was dropped; the declared one was kept",
  );
  assert.ok(
    course.warnings.some((w) => w.includes("answer-too-long-for-auto-grading")),
    `expected a rejection warning, got ${JSON.stringify(course.warnings)}`,
  );
});

test("a manifest with no units is invalid rather than silently empty", () => {
  const src = load("course-basic");
  const result = parseCourseManifest("# nothing here\n", src);
  assert.ok("error" in result && result.error.includes("no units"));
});

test("slug is stable and safe for ids", () => {
  assert.equal(slug("Alpha One!"), "alpha-one");
  assert.equal(slug("  --weird--  "), "weird");
});

// ---------------------------------------------------------------------------
// P17 — display names, never ids
// ---------------------------------------------------------------------------

test("a legacy slug course derives HUMAN module and group titles, and keeps the raw id", () => {
  // course-basic's cards are slug names (alpha-one), i.e. a course authored before this change or by
  // hand. Nothing is migrated: the model humanises what it PRINTS and leaves the identity alone.
  const course = buildCourse(load("course-basic"));
  const unit = course.units[0];

  assert.equal(unit.groups[0].title, "Alpha One", "the group heading is Title Case");
  // D10 changed WHAT the titles say — they name the exercise rather than repeating the concept — but this
  // test's real purpose is that they are DISPLAY strings built human, so it asserts that property instead of
  // the literal wording. Pinning the copy here would make every wording change look like a regression.
  const titles = unit.groups[0].modules.slice(0, 3).map((m) => m.title);
  assert.equal(new Set(titles).size, 3, `the three actions read differently: ${JSON.stringify(titles)}`);
  for (const title of titles) {
    assert.ok(title.length > 0, "each has a title");
    assert.ok(!title.includes("-"), `no raw slug leaks into a title: ${title}`);
    assert.ok(!/alpha one/i.test(title), `the concept name is not repeated on every row: ${title}`);
  }

  // …and the identity is untouched, which is what keeps telemetry, module ids and the grill prompt
  // working. The grill prompt carries the concept the tutor will match against SCHEMA.md.
  assert.equal(unit.title, "alpha-one", "the unit's own title stays the raw name");
  assert.equal(unit.groups[0].modules[0].concept, "alpha-one", "so does the module's concept");
  assert.equal(unit.groups[0].modules[0].id, "alpha-one/recite", "and the id is still the slug");
});

test("a course authored with human card names needs no humanising, and its ids are derived", () => {
  // What the scaffold skill now produces: a human heading, from which the app derives the slug.
  const dir = mkdtempSync(join(tmpdir(), "soc-human-"));
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "learning", "MISSION.md"),
    "# Wheel Alignment\n",
  );
  writeFileSync(
    join(dir, ".agent", "learning", "SCHEMA.md"),
    [
      "# Schema",
      "",
      "## Taxonomy",
      "",
      "### 🟩 Wheel anatomy and tension model",
      "",
      "- **Status:** 🟩 Good",
      "- **Definition (my own words):** the parts and how they load",
      "- **SM-2 telemetry:**",
      "  - `interval`: 3",
      "  - `ease_factor`: 2.5",
      "  - `repetitions`: 2",
      "",
    ].join("\n"),
  );
  const course = buildCourse(load2(dir));
  const unit = course.units[0];

  assert.equal(unit.title, "Wheel anatomy and tension model", "the heading is the name, verbatim");
  assert.equal(unit.groups[0].title, "Wheel Anatomy And Tension Model", "and reads the same as a slug would");
  // The point here is that the AUTHORED heading and the DERIVED slug converge — that is what makes a
  // hand-written course behave like a slug-named one. It is asserted on the concept, not on the row title:
  // D10 made the titles name the exercise, so the title no longer carries the concept by design.
  // `concept` stays RAW by design (`course-model.ts:229`) — it is the tutor's match key against SCHEMA.md
  // headings, so humanising it would break the join. The authored heading and the derived slug converge on the
  // GROUP TITLE, which is the humanised display string for the same card.
  assert.equal(
    unit.groups[0].title,
    "Wheel Anatomy And Tension Model",
    "the authored heading and the derived slug converge on one display string",
  );
  assert.equal(unit.groups[0].modules[0].concept, "Wheel anatomy and tension model", "the match key stays raw");
  assert.equal(unit.groups[0].modules[0].id, "wheel-anatomy-and-tension-model/recite", "the slug is derived");
  rmSync(dir, { recursive: true, force: true });
});

test("casing the slugger destroyed is not recovered — the documented limitation", () => {
  const dir = mkdtempSync(join(tmpdir(), "soc-acronym-"));
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(join(dir, ".agent", "learning", "SCHEMA.md"), "### 🟨 kpi-baseline-review\n\n- **Status:** 🟨 Fair\n");
  const course = buildCourse(load2(dir));
  assert.equal(course.units[0].groups[0].title, "Kpi Baseline Review", "Kpi, not KPI — nothing here guesses");
  rmSync(dir, { recursive: true, force: true });
});

test("no derived module title repeats the concept NAME the heading already shows", () => {
  // D10 — report #10 (`…d8d0851d`): "the top section just repeats 'How a house lighting circuit works' it
  // causes the string to lose their meaning and value". Measured on the real course page, the concept name
  // appeared FIVE times: the h1, the h2, and all three module rows. Each row is now named for its action.
  const course = buildCourse(load("course-basic"));
  const modules = course.units[0].groups[0].modules;
  const byType = new Map(modules.map((m) => [m.type, m]));

  const concept = course.units[0].groups[0].title;
  for (const [type, m] of byType) {
    if (!["recite", "review", "explain"].includes(type)) continue;
    assert.ok(
      !m.title.includes(concept),
      `${type} still repeats the concept name the heading already carries: ${JSON.stringify(m.title)}`,
    );
  }
  // And the three are distinguishable WITHOUT the small label underneath, which was the owner's complaint.
  const titles = ["recite", "review", "explain"].map((ty) => byType.get(ty)?.title);
  assert.equal(new Set(titles).size, 3, `the three actions must read differently: ${JSON.stringify(titles)}`);
  assert.equal(byType.get("misconceptions")?.title, "Misconceptions (2)", "the count module is untouched");

  // Scoped to the three verb-stripped types: `Misconceptions (N)` deliberately repeats its label,
  // because the count is the content of that row rather than its name.
  for (const mod of modules.filter((m) => m.type !== "misconceptions")) {
    const label = moduleTypeLabel(mod.type as ModuleType);
    assert.ok(
      !mod.title.toLowerCase().startsWith(label.toLowerCase()),
      `${mod.type} title "${mod.title}" repeats its own type label "${label}"`,
    );
  }
});

test("every visible module title is distinct, so the accessible names need no rescuing", () => {
  // This test USED to assert the opposite premise: "the premise: some visible titles repeat … and every
  // accessible name is distinct". D10 removed the repetition, so the premise no longer holds and the ring
  // label's type prefix is now belt-and-braces rather than the only distinction.
  const course = buildCourse(load("course-basic"));
  const modules = course.units[0].groups[0].modules.filter((m) => m.mastery);
  const visible = modules.map((m) => m.title);
  const accessible = modules.map((m) => moduleRingLabel(m.type as ModuleType, m.title, m.mastery!.state));

  assert.equal(new Set(visible).size, visible.length, `visible titles are distinct: ${JSON.stringify(visible)}`);
  assert.equal(new Set(accessible).size, accessible.length, "and accessible names still are");
});

test("a quiz module's title is humanised, not the raw unit id", () => {
  // A1: this built its display string from `unit.title`, so a quiz on a slug-named unit rendered
  // `suspension-angle-vocabulary quiz` while the module titles a few lines away were already human.
  const dir = mkdtempSync(join(tmpdir(), "soc-quiz-title-"));
  mkdirSync(join(dir, ".agent", "learning"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "learning", "COURSE.md"),
    [
      "# Course",
      "",
      "## Unit 1: suspension-angle-vocabulary",
      "",
      "- **Quiz** 2 items",
      "",
    ].join("\n"),
  );
  const course = buildCourse(load2(dir));
  const all = course.units.flatMap((u) => u.groups.flatMap((g) => g.modules));
  const quiz = all.find((m) => m.type === "quiz");

  assert.ok(quiz, `expected a quiz module; got ${JSON.stringify(all.map((m) => `${m.type}:${m.title}`))}`);
  assert.equal(quiz!.title, "Suspension Angle Vocabulary quiz", "the display title is human");
  assert.equal(quiz!.id, "suspension-angle-vocabulary/quiz", "the id keeps the raw name");
  rmSync(dir, { recursive: true, force: true });
});
