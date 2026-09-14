/**
 * F3 — the composer cannot show a long draft.
 *
 * Measured with 8 lines typed: `scrollHeight 199 / clientHeight 42 / overflowY: auto`. Text is NOT lost —
 * `allTextReachable: true` — so this is a usability cap, not data loss. `max-height: 150px` is already
 * declared and currently dead: nothing ever sets a height above ~44px, so the cap can never be reached.
 *
 * The fix wires the existing cap rather than inventing a new one. There is no DOM here, so this pins the
 * mechanism and the cap; the growth itself is measured in the browser and pasted in the report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const lesson = readFileSync(join(import.meta.dirname, "components", "LessonPage.tsx"), "utf8");
const css = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

test("the composer grows with its content", () => {
  // The ref sits BEFORE the aria-label in the element, so slice from the element's opening tag.
  const start = lesson.indexOf("<textarea");
  const el = lesson.slice(start, lesson.indexOf("/>", start));
  assert.match(el, /ref=\{composerRef\}/, "the textarea needs a ref to size itself");
  assert.match(lesson, /scrollHeight/, "sizing reads scrollHeight");
  // The effect aliases the ref to `el` first, so assert on the WRITE, not on a particular expression.
  assert.match(lesson, /el\.style\.height\s*=/, "and writes an explicit height");
});

test("the cap is the one already declared, not a new number", () => {
  const rule = css.slice(css.indexOf(".composer textarea {"), css.indexOf(".composer textarea::placeholder"));
  // The cap is a custom property so the JS clamp and this rule cannot drift apart.
  assert.match(rule, /max-height:\s*calc\(var\(--composer-max\)/, `expected the declared cap, got ${rule.trim()}`);
  assert.match(css, /--composer-max:\s*150/, "the cap's value lives in one place");
  assert.match(lesson, /COMPOSER_MAX_PX/, "the growth clamps at that cap");
});

test("the reset is not forgotten — an emptied composer must shrink back", () => {
  // The classic bug in autosizing: it grows and never shrinks, so the composer stays tall after send.
  assert.match(lesson, /height = "auto"/, "it must reset to auto before measuring, or it only ever grows");
});
