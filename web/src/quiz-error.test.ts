/**
 * B2a — a course-level failure must not be reported as a quiz failure.
 *
 * `QuizPage` and `LabPage` load two things at once (`Promise.all([fetchCourse, fetchAssessments])`), so a
 * bare `catch` cannot tell which failed. Both collapsed into a material-specific message, so a course that
 * could not be read was blamed on the quiz — and the error branch offered "Try generating again", a remedy
 * for a failure that had not happened.
 *
 * These are pure-function tests over the classification and the view it produces. The component simply
 * renders the result, so the decision is testable without a DOM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMaterialFailure, materialFailureView } from "./course-error.ts";

test("a course that cannot be read is classified as a course failure", () => {
  // The api layer's phrasing for a 404 on the course route.
  assert.equal(classifyMaterialFailure("unknown course: locked"), "course");
  assert.equal(classifyMaterialFailure("unknown course: bicycle-wheel-truing"), "course");
  // and it must NOT be mistaken for a material failure
  assert.notEqual(classifyMaterialFailure("unknown course: locked"), "material");
});

test("a material failure is classified as material, so the retry control survives", () => {
  // The test that stops the fix from over-correcting: generation IS retryable, because the model is
  // nondeterministic and a second attempt can succeed.
  assert.equal(classifyMaterialFailure("generation did not produce usable items"), "material");
  assert.equal(classifyMaterialFailure("no generated item passed validation"), "material");
  assert.equal(classifyMaterialFailure("the agent did not finish within 180s"), "material");
});

test("a course-level failure does not blame the quiz and offers no retry", () => {
  const view = materialFailureView("unknown course: locked", "quiz");
  assert.ok(!/quiz/i.test(view.heading), `the headline must not blame the quiz: ${view.heading}`);
  assert.equal(view.retryable, false, "generating again cannot fix a course that cannot be read");
  assert.ok(view.detail.length > 0);
  // it points at the real cause
  assert.match(view.detail, /no course called|renamed/i);
});

test("a generation failure still blames the material and still offers a retry", () => {
  const quiz = materialFailureView("generation did not produce usable items", "quiz");
  assert.match(quiz.heading, /quiz/i, "a genuine quiz failure may say so");
  assert.equal(quiz.retryable, true, "…and may be retried");

  const lab = materialFailureView("generation did not produce a usable interactive", "interactive");
  assert.match(lab.heading, /interactive/i);
  assert.equal(lab.retryable, true);
});

test("the lab page gets the same classification, since its structure is the same", () => {
  const course = materialFailureView("unknown course: gone", "interactive");
  assert.equal(course.retryable, false);
  assert.ok(!/interactive/i.test(course.heading), `must not blame the interactive: ${course.heading}`);
});

// ---------------------------------------------------------------------------
// The wiring. There is no DOM renderer in this suite by design (see web/package.json — React only), so
// these assert the SOURCE, the same technique the render-site guard uses. The pure tests above pin the
// decision; these pin that the components actually ask for it.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = (name: string) =>
  readFileSync(join(import.meta.dirname, "components", name), "utf8");

test("QuizPage classifies its failure instead of hardcoding a quiz error", () => {
  const src = component("QuizPage.tsx");
  assert.ok(
    !/"could not load the quiz"/.test(src),
    "the hardcoded material message is what misattributed a course failure",
  );
  assert.match(src, /materialFailureView\(/, "it must ask the classifier who to blame");
});

test("LabPage classifies its failure the same way", () => {
  const src = component("LabPage.tsx");
  assert.ok(!/"could not load interactives"/.test(src), "same collapse, same fix");
  assert.match(src, /materialFailureView\(/, "and the same classifier");
});

test("the retry control is conditional on the failure being retryable", () => {
  // The ERROR branch's generate control must be gated, or a course failure offers a remedy that cannot
  // work. The guard sits on the WRAPPING conditional, not on the button line, so the assertion is on the
  // block. There is a SECOND generate button per page — the "no quiz yet" empty state — which is correctly
  // unconditional, because the course loaded fine there. So the check is scoped to the error branch.
  for (const name of ["QuizPage.tsx", "LabPage.tsx"]) {
    const src = component(name);
    const lines = src.split("\n");
    const retryAt = lines.findIndex((l) => l.includes("material?.retryable !== false"));
    assert.ok(retryAt > 0, `${name}: the error branch's retry control must be gated on retryable`);
    const block = lines.slice(retryAt, retryAt + 6).join("\n");
    assert.match(block, /void generate\(\)/, `${name}: the guard must wrap the generate control`);
    // Every generate control keeps at least its own generating guard.
    const bare = lines.filter((l) => l.includes("onClick={() => void generate()}") && !l.includes("disabled={generating}"));
    assert.deepEqual(bare, [], `${name}: a generate control lost its disabled guard`);
  }
});
