/**
 * capture.ts — grabbing one frame, and everything that can go wrong.
 *
 * `getDisplayMedia` per the owner's decision: no dependency, no screenshot library. The project ships two
 * runtime dependencies and this feature does not justify a third.
 *
 * THE FAILURE PATH IS THE IMPORTANT ONE. Every way this can fail — denied, dismissed, unavailable, insecure
 * context — resolves to a `{ ok: false, reason }` rather than throwing, because a capture failure must never
 * block reporting a bug. Dismissing the dialog is the ORDINARY case, not the exceptional one.
 *
 * A LIVE TRACK IS ALWAYS STOPPED. Leaving one running keeps the browser's "sharing" indicator on, which is
 * alarming and pointless for a still frame.
 */

export interface Frame {
  /** A data URL, ready to put in an `<img src>` and to post as `imageBase64`. */
  dataUrl: string;
  width: number;
  height: number;
}

export type CaptureResult = { ok: true; frame: Frame } | { ok: false; reason: string };

/** The size cap, matching the server's: a capture larger than this is refused before it is sent. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Why a capture could not happen, in words the panel can show.
 *
 * `NotAllowedError` covers both denial and dismissal — the browser does not distinguish them, and neither can
 * this. The copy therefore does not claim which one happened.
 */
export function captureFailureReason(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError") return "the screen share was dismissed or denied";
  if (name === "NotFoundError") return "no screen was available to capture";
  if (name === "NotReadableError") return "the screen could not be read — another app may be capturing it";
  if (name === "AbortError") return "the capture was cancelled";
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message ? `capture unavailable (${message})` : "capture unavailable";
}

/** True when the browser can even attempt a capture — including the secure-context requirement. */
export function captureSupported(nav: Navigator = navigator, secure = window.isSecureContext): boolean {
  return Boolean(secure && nav.mediaDevices && typeof nav.mediaDevices.getDisplayMedia === "function");
}

/**
 * One frame, then stop everything.
 *
 * The stream is stopped in a `finally`, so a throw between grabbing the video and reading the canvas cannot
 * leave a track running — the sharing indicator staying on after a failed capture is exactly the kind of
 * thing that makes a tool feel unsafe.
 */
export async function captureFrame(): Promise<CaptureResult> {
  if (!captureSupported()) {
    return { ok: false, reason: "screen capture needs a secure context and a supported browser" };
  }
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // One rendered frame is enough; `requestVideoFrameCallback` is not universally available, so waiting for
    // a playing video is the portable signal.
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return { ok: false, reason: "the captured frame had no size" };

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "this browser would not provide a drawing context" };
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/png");
    return { ok: true, frame: { dataUrl, width, height } };
  } catch (err) {
    return { ok: false, reason: captureFailureReason(err) };
  } finally {
    // ALWAYS. A still frame does not need a live track.
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        /* already gone */
      }
    }
  }
}

/** How many bytes a data URL actually carries, once the base64 inflation is undone. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Whether a frame is small enough to send. Checked before posting, so the refusal is instant and local. */
export function frameWithinCap(frame: Frame): boolean {
  return dataUrlBytes(frame.dataUrl) <= MAX_IMAGE_BYTES;
}
