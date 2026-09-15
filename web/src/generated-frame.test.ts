/**
 * generated-frame.test.ts — the isolation, asserted at the source.
 *
 * The whole security posture of generated content is one attribute combination, so it is pinned here rather
 * than left to a code review that may not know why it matters. There is no DOM in this suite (see
 * web/package.json), so this reads the component; the FRAME BEHAVIOUR — a diagram rendering, the height
 * following its content, a script inside it being unable to reach the app — was verified by hand in a browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "components", "GeneratedFrame.tsx"), "utf8");

test("the frame is sandboxed with allow-scripts and WITHOUT allow-same-origin", () => {
  // Without allow-same-origin the frame has a null origin: its scripts cannot read the app's cookies,
  // localStorage or window.parent internals, nor make credentialed same-origin API calls.
  assert.match(src, /sandbox="allow-scripts"/, "the sandbox attribute is exactly this");
  assert.ok(
    !/allow-same-origin/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")),
    "adding allow-same-origin would make the frame same-origin and remove every guarantee",
  );
});

test("the frame is given no referrer and no permissions", () => {
  assert.match(src, /referrerPolicy="no-referrer"/);
  assert.ok(!/allow="(?!.*no-referrer)/.test(src) || !/\ballow=\{/.test(src), "no permission grants");
});

test("the document carries a restrictive CSP as defence in depth", () => {
  // The sandbox is the guarantee; the CSP narrows what the frame can fetch even so. `default-src 'none'`
  // means no scripts from anywhere, no network requests for images or fonts beyond data: URIs.
  assert.match(src, /Content-Security-Policy/);
  assert.match(src, /default-src 'none'/);
});

test("a message from the frame is only trusted for a height, and only from our frame", () => {
  // A null origin means `e.origin` identifies nothing, so the frame is tagged with an id and only a numeric
  // height from that id is accepted. Anything else a frame sends is ignored.
  assert.match(src, /data\.frameId !== id\.current/, "the message must come from this frame");
  assert.match(src, /typeof data\.height !== "number"/, "and must be a number");
  assert.match(src, /maxHeight/, "the height is clamped, so a frame cannot grow without bound");
});

test("the frame cannot exceed its clamped range in either direction", () => {
  assert.match(src, /Math\.max\(minHeight, Math\.min\(maxHeight/, "clamped between min and max");
});

test("D4 — the CSP permits the measuring script, since nothing else can measure the frame", () => {
  // THE DEFECT THIS PINS. The policy was `default-src 'none'` with no `script-src`, which blocked the frame's
  // own height script. The frame then stayed at `minHeight` forever: measured in a browser, an 80px frame
  // holding 900px of content with no internal scrollbar, so most of a diagram was unreachable. Report #4
  // (`2026-09-15T05-10-32-595Z-324ec8df`).
  //
  // The two are coupled: the app cannot measure the frame (null origin makes `contentDocument` unreachable), so
  // the frame must measure itself, so `script-src` must allow it. Asserted together, because a future edit that
  // "tightens" the CSP would silently restore the clipping.
  const cspLine = src.split("\n").find((l) => l.includes("Content-Security-Policy"));
  assert.ok(cspLine, "the frame carries a policy");
  assert.match(cspLine, /script-src 'unsafe-inline'/, "the measuring script must be allowed to run");
  assert.match(cspLine, /default-src 'none'/, "and nothing else is");
});

test("D4 — the frame reports its height, and re-reports after content settles", () => {
  // An SVG that has not painted measures short, so a single measurement is not enough — that is how a diagram
  // gets clipped even with the script running.
  assert.match(src, /postMessage\(\{ frameId: id, height: h \}/, "the height is reported");
  assert.match(src, /addEventListener\("load", report\)/, "and re-reported once the document has loaded");
});
