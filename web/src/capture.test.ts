/**
 * capture.test.ts — the parts of the capture path that do not need a browser dialog.
 *
 * STATED PLAINLY, because implying coverage that does not exist is worse than none: the permission dialog
 * itself CANNOT be driven from a unit test. What is tested here is the failure classification, the secure-
 * context gate, the byte arithmetic and the cap. The frame grab, the thumbnail and the retake were verified
 * BY HAND in a real browser — see the report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_IMAGE_BYTES,
  captureFailureReason,
  captureSupported,
  dataUrlBytes,
  frameWithinCap,
} from "./capture.ts";

test("a denial and a dismissal both read as dismissed-or-denied, because the browser cannot tell them apart", () => {
  const e = Object.assign(new Error("x"), { name: "NotAllowedError" });
  const reason = captureFailureReason(e);
  assert.match(reason, /dismissed or denied/);
  assert.ok(!/error/i.test(reason), `no raw error name in learner-facing copy: ${reason}`);
});

test("each failure mode gets its own sentence", () => {
  const mk = (name: string) => Object.assign(new Error(name), { name });
  assert.match(captureFailureReason(mk("NotFoundError")), /no screen/);
  assert.match(captureFailureReason(mk("NotReadableError")), /another app/);
  assert.match(captureFailureReason(mk("AbortError")), /cancelled/);
  // an unrecognised failure still says something human and non-empty
  assert.ok(captureFailureReason(new Error("weird")).length > 0);
  assert.ok(captureFailureReason(undefined).length > 0);
  assert.ok(captureFailureReason("a string, not an Error").length > 0);
});

test("an insecure context is refused up front rather than rejecting on click", () => {
  const nav = { mediaDevices: { getDisplayMedia: () => {} } } as unknown as Navigator;
  assert.equal(captureSupported(nav, true), true);
  assert.equal(captureSupported(nav, false), false, "http:// is not a secure context");
  const noApi = { mediaDevices: {} } as unknown as Navigator;
  assert.equal(captureSupported(noApi, true), false, "an unsupported browser degrades");
});

test("the byte count undoes base64 inflation instead of trusting the string length", () => {
  // A cap checked on the encoded length would be ~33% wrong.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  assert.equal(dataUrlBytes(dataUrl), 4, "4 bytes in, 4 bytes counted");
  assert.equal(dataUrlBytes("not-a-data-url"), 0);
  // padding is accounted for
  for (const n of [1, 2, 3, 4, 5]) {
    const bytes = Buffer.alloc(n, 1);
    assert.equal(dataUrlBytes(`data:image/png;base64,${bytes.toString("base64")}`), n, `${n} bytes`);
  }
});

test("the cap is checked before sending, so an oversized frame is refused locally", () => {
  const small = { ok: true as const, frame: { dataUrl: `data:image/png;base64,${Buffer.alloc(1000).toString("base64")}`, width: 1, height: 1 } };
  assert.equal(frameWithinCap(small.frame), true);

  const huge = { dataUrl: `data:image/png;base64,${"A".repeat(Math.ceil((MAX_IMAGE_BYTES + 10) / 3) * 4)}`, width: 1, height: 1 };
  assert.equal(frameWithinCap(huge), false, "over the cap");
  assert.equal(MAX_IMAGE_BYTES, 8 * 1024 * 1024, "the cap matches the server's");
});

test("the capture asks for the current tab, and does not depend on getting it", () => {
  // The owner reported their localhost tab missing from the picker's tab list, and a window capture that
  // included the picker itself. `preferCurrentTab` makes the current tab the default where it is supported
  // (Chrome/Edge); `selfBrowserSurface: "include"` is what governs whether the current tab is LISTED at all.
  // Brave does not expose either, and unsupported constraint keys are ignored rather than throwing — so the
  // request is additive and must never be load-bearing.
  const source = readFileSync(join(import.meta.dirname, "capture.ts"), "utf8");
  assert.match(source, /preferCurrentTab:\s*true/, "the current tab is preferred where supported");
  assert.match(source, /selfBrowserSurface:\s*"include"/, "and the current tab is offered as a choice");
  // It must still work when both are ignored: the call itself carries only `video`.
  assert.match(source, /getDisplayMedia\(constraints\)/, "the constraints are passed as one object");
  assert.ok(!/if \(.*preferCurrentTab.*\)\s*throw/.test(source), "an ignored constraint must never throw");
});

test("the frame is taken after a PAINT, not merely after play() resolves", () => {
  // Reported: choosing the window captured the picker overlay, because `play()` resolving means playback
  // STARTED, not that a clean frame has been delivered. The fix waits on the frame callback.
  const source = readFileSync(join(import.meta.dirname, "capture.ts"), "utf8");
  assert.match(source, /requestVideoFrameCallback/, "it waits for a delivered frame");
  assert.match(source, /await nextFrame\(video\);\s*\n\s*await nextFrame\(video\);/,
    "twice, since the first callback can report a frame that predates the picker closing");
  // and the portable fallback exists for browsers without the callback
  assert.match(source, /requestAnimationFrame/, "with a fallback for browsers lacking the callback");
});
