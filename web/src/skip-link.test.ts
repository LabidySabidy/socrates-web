/**
 * F2 — a keyboard user cannot skip the chrome and cannot get back in.
 *
 * The lesson route has 5 focusable elements and no skip link: Tab walks the brand link, the Budapest toggle,
 * the breadcrumb and "Exit Lesson" before reaching anything a learner came for. Every element that CAN be
 * focused does show a ring, so this is about entry and exit, not focus visibility.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(import.meta.dirname, p), "utf8");

test("a skip link is the first focusable element and targets a real landmark", () => {
  const app = read("App.tsx");
  // It must come before anything else focusable, so the assertion is on ORDER within the file.
  const skipAt = app.indexOf('className="skip-link"');
  assert.ok(skipAt > 0, "no skip link in App.tsx — a keyboard user has no way past the chrome");
  const brandAt = app.indexOf("<TopBar");
  assert.ok(brandAt > skipAt, `the skip link must precede the chrome it skips (skip at ${skipAt}, chrome at ${brandAt})`);
  assert.match(app, /href="#main-content"/, "it must target the main landmark by id");
});

test("the skip target exists in every rendered route", () => {
  // The lesson route wraps its content in `div.lesson`, NOT `<main>` — so a skip link pointing at a
  // landmark that is absent on the page the learner is on would move focus nowhere.
  const lesson = read("components/LessonPage.tsx");
  assert.match(lesson, /id="main-content"/, "the lesson must carry the skip target");
  const home = read("components/HomePage.tsx");
  assert.match(home, /id="main-content"/, "and so must the home route");
});

test("the skip link is visually hidden until focused", () => {
  const css = read("theme.css");
  // Read the WHOLE rule, not its first line: `.skip-link` is multi-line, and a one-line helper silently
  // asserted on half of it — the same mistake the label test made before it was corrected.
  const lines = css.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(".skip-link {"));
  assert.ok(start >= 0, "no .skip-link rule");
  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    body.push(lines[i]);
    if (lines[i].includes("}")) break;
  }
  const rule = body.join("\n");
  assert.match(rule, /position:\s*(absolute|fixed)/, "it must be out of flow while hidden");
  assert.match(css, /\.skip-link:focus/, "it must have a :focus state that reveals it");
  assert.match(css, /#main-content:focus/, "the target needs a focus style so the move is not jarring");
});

test("there is no focus trap — this is a document, not a modal", () => {
  // The over-correction to avoid: trapping Tab inside the app. Asserting the ABSENCE of trap machinery.
  for (const file of ["App.tsx", "components/LessonPage.tsx", "components/HomePage.tsx"]) {
    const src = read(file);
    assert.ok(!/focusTrap|trapFocus|inert=|focusin.*preventDefault/.test(src), `${file} appears to trap focus`);
  }
});

test("activating the skip link moves FOCUS, not just the scroll position", () => {
  // Measured in the browser: `href="#main-content"` alone left `document.activeElement` on <body>, so the
  // next Tab went back to the chrome. A skip link that scrolls but does not focus skips nothing.
  const app = read("App.tsx");
  assert.match(app, /getElementById\("main-content"\)/, "it must find the target element");
  assert.match(app, /target\.focus\(\)/, "and move focus to it explicitly");
  assert.match(app, /preventDefault\(\)/, "and not rely on the fragment jump, which does not focus");
});
