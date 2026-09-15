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
import { paintPosition } from "./capture-position.ts";

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
    // ASK FOR THIS TAB FIRST WHERE IT IS SUPPORTED.
    //
    // `preferCurrentTab` makes the picker default to the tab you are looking at, which is what a bug report
    // almost always wants. Chrome and Edge honour it; Brave does not expose it, and unsupported keys in a
    // constraint dictionary are IGNORED rather than throwing — so this is additive and costs nothing where
    // it is not supported. `selfBrowserSurface: "include"` is the part that makes the CURRENT tab a listed
    // choice rather than excluded; the owner reported that their localhost tab did not appear under the
    // Brave-tab list, and this is the constraint that governs that.
    //
    // Neither is load-bearing: if a browser ignores both, the picker behaves exactly as before.
    const constraints = {
      video: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions;
    stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    // WAIT FOR A PAINTED FRAME, then wait again.
    //
    // `play()` resolving only means playback STARTED. Grabbing immediately can capture the frame still
    // showing the browser's share picker, because that overlay is composited into the captured surface and
    // nothing guarantees a clean frame has been delivered yet. Reported by the owner: choosing the window
    // produced a screenshot with the picker in it.
    //
    // Two awaits, because the first callback can fire on a frame that predates the picker closing: the
    // first gets a frame, the second gets one that is at least a paint later.
    await nextFrame(video);
    await nextFrame(video);
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

/**
 * Resolve once the video has delivered a frame.
 *
 * `requestVideoFrameCallback` is the API that means "a frame is ready"; where it is missing, a double
 * `requestAnimationFrame` is the portable approximation. Neither is a substitute for the other's guarantee,
 * so both are tried rather than assuming one exists.
 */
async function nextFrame(video: HTMLVideoElement): Promise<void> {
  if (typeof video.requestVideoFrameCallback === "function") {
    await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
    return;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * A DOM capture: the app's own interface, with no permission prompt and no picker.
 *
 * WHY THIS EXISTS. The owner filed two reports and the screen-capture dialog appeared both times, listing
 * tabs and windows for a defect that was entirely inside this app. Almost every defect filed against a web
 * UI is visible in the DOM, and a DOM capture is instant, prompts nothing, and cannot accidentally include
 * another tab or a native dialog.
 *
 * WHAT IT CANNOT DO, stated so nobody trusts it further than it goes: it renders the DOM, so it does not
 * capture the browser chrome, devtools, a native OS dialog, another tab, or a second monitor. For those, the
 * screen capture is still the right tool, which is why both exist rather than one replacing the other.
 *
 * NO DEPENDENCY. This walks the live DOM and paints it into a canvas. It does NOT attempt a faithful
 * screenshot of arbitrary CSS — no `html2canvas`. What it does is deliberately simple and honest: it paints
 * the page's background colour, then renders each VISIBLE element's text and box at its measured position.
 * That reproduces exactly the kind of defect being reported (a missing control, overlapping text, a wrong
 * label) without pretending to be a pixel-perfect renderer.
 *
 * POSITIONS ARE VIEWPORT-RELATIVE. `getBoundingClientRect()` already is, so no scroll offset is added per
 * element — doing so double-counted the scroll and shifted everything by it. The scroll origin is needed, but
 * ONCE for the canvas (`scrollOriginOf`), never per element. The owner's own layout scrolls inside an inner
 * pane rather than the document, which is why the origin is resolved from the nearest scrollable ancestor.
 */
export interface DomCaptureResult extends Frame {
  /** How many elements were painted, so a caller can tell an empty render from a full one. */
  elements: number;
  /**
   * SVG icons still decoding, drawn by `captureDomAsync`. ABSENT on a finished capture, so a caller cannot
   * mistake a pending list for a completed one.
   */
  pendingSvg?: { image: HTMLImageElement; x: number; y: number; width: number; height: number }[];
}

/**
 * Elements that are painted, and those deliberately left out.
 *
 * TWO EXCLUSIONS, both learned from the first real capture:
 *
 *  1. THE PANEL ITSELF. The report panel is open when the capture runs, so it was being painted INTO the
 *     screenshot — the app photographed its own bug-report form. Anything inside `.report-sheet` is skipped,
 *     which is what "capture this page" has to mean when the page is the thing being reported on.
 *  2. ANYTHING OFF-SCREEN. The skip link sits at `left: -9999px`, so its text was painted at x = -9999 —
 *     outside the canvas, and on a wider canvas it would appear as stray text at the origin. Off-canvas
 *     elements are not part of what the reporter is looking at.
 */
function isVisible(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  if (el.closest(".report-sheet")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  // Entirely off to the left or above: not on screen, so not in the picture.
  if (rect.right <= 0 || rect.bottom <= 0) return false;
  return true;
}

/**
 * Render the current document into a canvas.
 *
 * Deliberately NOT a full CSS renderer: it paints the page background, then each visible element's own
 * background and its text. Text is positioned from `getBoundingClientRect`, so an overlap, a missing control
 * or a mislabelled button all show up — which is what a bug report needs to show.
 */
export function captureDom(doc: Document = document, scale = 1): DomCaptureResult {
  const pendingSvg: { image: HTMLImageElement; x: number; y: number; width: number; height: number }[] = [];
  const width = Math.max(doc.documentElement.clientWidth, 320);
  const height = Math.max(Math.min(doc.documentElement.scrollHeight, 4000), 200);
  const canvas = doc.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl: "", width: 0, height: 0, elements: 0, pendingSvg };
  ctx.scale(scale, scale);

  // The page's own background, so the image is not transparent where nothing is painted.
  const bodyBg = getComputedStyle(doc.body).backgroundColor;
  ctx.fillStyle = bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" ? bodyBg : "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let painted = 0;
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const style = getComputedStyle(el);
    if (!isVisible(el, style)) continue;
    const rect = el.getBoundingClientRect();
    // NO scroll offset is added here. `getBoundingClientRect()` is already viewport-relative, which is the
    // space this canvas draws in. The previous version added `scrollLeft/scrollTop` on top of that and so
    // double-counted it: measured in a browser, a page scrolled by 48px painted every element 48px too low,
    // which is the doubled and overlapping text in the owner's screenshots.
    const { x, y } = paintPosition(rect);

    const bg = style.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)") {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, rect.width, rect.height);
    }

    // IMAGES AND ICONS. The first version of this painted only backgrounds and text, so every `<img>` and
    // every SVG was silently absent — including the report screenshots on the review page. Silent is the
    // worst property for that: a page with no logo looks like a page that has no logo, not like a bug in
    // the capture. Both are drawn here.
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      try {
        ctx.drawImage(img, x, y, rect.width, rect.height);
        painted++;
      } catch {
        // A cross-origin image with no CORS headers taints the canvas. Skipping it keeps the REST of the
        // capture usable, which matters more than the one image — a tainted canvas throws on toDataURL and
        // would produce NO screenshot at all.
      }
      continue;
    }
    if (el.tagName === "svg" || el instanceof SVGSVGElement) {
      try {
        // An inline SVG is serialised and drawn as an image, so icons and the emblem survive.
        const clone = el.cloneNode(true) as SVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const xml = new XMLSerializer().serializeToString(clone);
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
        const svgImage = new Image();
        svgImage.src = url;
        // Synchronous drawing is not possible for a data URL in every engine, so the SVG is queued and
        // drawn by `captureDomAsync`. See below.
        pendingSvg.push({ image: svgImage, x, y, width: rect.width, height: rect.height });
      } catch {
        /* a malformed SVG must not lose the whole capture */
      }
      continue;
    }

    // Only elements with their OWN text are painted, so a container does not repaint its children's words.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (own) {
      ctx.fillStyle = style.color;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.textBaseline = "top";
      const lines = own.split(/\s+/);
      let line = "";
      let ly = y;
      const maxWidth = rect.width || width;
      for (const word of lines) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, ly);
          line = word;
          ly += parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 16;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, x, ly);
      painted++;
    }
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: Math.round(width),
    height: Math.round(height),
    elements: painted,
    pendingSvg,
  };
}

/**
 * The same capture, but WAITING for SVG icons to decode before the PNG is produced.
 *
 * `captureDom` returns immediately with the raster content drawn and any SVG queued; this awaits those, draws
 * them, and then reads the canvas. The sync version is kept because a caller that cannot await still gets a
 * usable screenshot (minus icons) rather than nothing.
 */
export async function captureDomAsync(doc: Document = document, scale = 1): Promise<DomCaptureResult> {
  const shot = captureDom(doc, scale);
  if (!shot.pendingSvg || shot.pendingSvg.length === 0) {
    const { pendingSvg: _drop, ...rest } = shot;
    return rest;
  }
  const canvas = doc.createElement("canvas");
  canvas.width = Math.round(shot.width * scale);
  canvas.height = Math.round(shot.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ...shot, pendingSvg: [] };
  ctx.scale(scale, scale);

  const base = await loadImage(shot.dataUrl);
  ctx.drawImage(base, 0, 0, shot.width, shot.height);
  for (const item of shot.pendingSvg ?? []) {
    try {
      await loadImageElement(item.image);
      ctx.drawImage(item.image, item.x, item.y, item.width, item.height);
    } catch {
      /* an icon that will not decode must not lose the capture */
    }
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: shot.width,
    height: shot.height,
    elements: shot.elements + (shot.pendingSvg?.length ?? 0),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

function loadImageElement(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg decode failed"));
  });
}
