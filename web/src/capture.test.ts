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
