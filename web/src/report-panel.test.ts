/**
 * report-panel.test.ts — the panel's rules, asserted at the source.
 *
 * No DOM renderer in this suite by design (see web/package.json — React only), so these pin the wiring and
 * the two decisions that must not drift: Escape discards an EMPTY draft and confirms a NON-EMPTY one, and
 * Save is disabled while the required field is empty so the client cannot offer an action guaranteed to fail.
 *
 * STATED PLAINLY: the permission dialog, the thumbnail, the retake and the docked layout were verified BY
 * HAND in a browser. Nothing here implies coverage of those.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(import.meta.dirname, p), "utf8");
const panel = read("components/ReportBugPanel.tsx");

test("the control is global — it renders from the top bar, not from a page", () => {
  const topbar = read("components/TopBar.tsx");
  assert.match(topbar, /className="report-trigger"/, "the capture control lives in the top bar");
  assert.match(topbar, /href="#\/reports"/, "and the review screen is one click away, not buried");
  const app = read("App.tsx");
  assert.match(app, /<TopBar/, "the top bar renders on every route");
  assert.match(app, /reporting \? \(/, "and the panel is mounted at app level, so every route has it");
});

test("the panel is docked, not a modal", () => {
  const css = read("theme.css");
  const rule = css.slice(css.indexOf(".report-sheet {"));
  assert.match(rule, /position:\s*fixed/, "fixed to the viewport");
  assert.match(rule, /bottom:\s*0/, "docked to the bottom");
  assert.match(rule, /max-height/, "and bounded, so it never covers the whole page");
  assert.ok(!/role="dialog"|aria-modal/.test(panel), "it must NOT declare itself a modal");
});

test("Escape closes an empty draft and confirms a non-empty one", () => {
  // The decision: losing a half-written report to a stray keypress defeats the feature's purpose.
  assert.match(panel, /e\.key !== "Escape"/, "Escape is handled");
  assert.match(panel, /if \(hasDraft && !confirmDiscard\)/, "a draft intercepts the first Escape");
  assert.match(panel, /setConfirmDiscard\(true\)/, "…by asking");
  assert.match(panel, /Discard/);
  assert.match(panel, /Keep editing/, "and the draft can be kept");
});

test("Save is disabled while the required field is empty", () => {
  // The Group 1 rule: the client must never offer an action guaranteed to fail.
  assert.match(panel, /disabled=\{busy \|\| !whatIsWrong\.trim\(\)\}/, "the button gates on the required field");
});

test("a failed capture still allows saving, and says why", () => {
  // The ordinary case for anyone who dismisses the dialog. This is the test that matters most in this file.
  assert.match(panel, /You can still save the report/, "the copy says the report is still submittable");
  assert.match(panel, /setCaptureNote\(/, "and the reason is shown");
  // Save must not be gated on a frame existing.
  assert.ok(!/disabled=\{[^}]*frame/.test(panel), "the save button must never depend on a capture");
});

test("the thumbnail REPLACES rather than appending", () => {
  assert.match(panel, /setFrame\(result\.frame\)/, "a retake replaces the single frame state");
  assert.match(panel, /Retake/, "and there is a control for it");
  // one frame, not a list
  assert.ok(!/frames\b/.test(panel), "there is one frame, not an array of them");
});

test("the transcript is offered only when there is one, and sent only when asked", () => {
  assert.match(panel, /transcript\.length > 0 \?/, "the checkbox appears only with a conversation");
  assert.match(panel, /attachTranscript && transcript\.length > 0 \? transcript : null/, "and is opt-in");
});
