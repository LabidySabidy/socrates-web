/**
 * GeneratedFrame.tsx — HTML and SVG from the tutor, rendered in a sandbox.
 *
 * Tier 2 of the rendering decision (DECISIONS.md, 2026-09-14). The isolation is ONE attribute combination:
 *
 *     sandbox="allow-scripts"        (and deliberately NOT allow-same-origin)
 *
 * Without `allow-same-origin` the frame gets a NULL origin, so its scripts cannot read the app's cookies,
 * localStorage, `window.parent` internals, or make credentialed same-origin requests to `/api/...`.
 *
 * ADDING `allow-same-origin` HERE WOULD REMOVE EVERY GUARANTEE THIS FILE PROVIDES. With both flags the frame
 * is same-origin with the app, so generated content could read the learner's data and call the API as them.
 * That is the classic mistake this comment exists to prevent, and there is a test asserting the attribute
 * stays as it is.
 *
 * WHAT THE SANDBOX DOES NOT STOP, stated so nobody trusts it further than it goes: the frame can still make
 * network requests (so it could send somewhere what a learner types INTO the frame), it can consume CPU, and
 * with `allow-scripts` it can navigate itself. This app renders content generated for the learner rather than
 * presenting them with a page they did not ask for, so those are accepted — but they are the reason the
 * frame gets no route to the app's data, and the reason rendering inline was refused outright.
 */
import { useEffect, useRef, useState } from "react";

/** The document a frame is given. Inline styles only — a frame inherits nothing from the app. */
function wrap(body: string, background: string, color: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    background: ${background};
    color: ${color};
    font: 13.5px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 10px 12px;
  }
  svg { max-width: 100%; height: auto; display: block; }
  * { max-width: 100%; }
</style></head>
<body>${body}</body></html>`;
}

/**
 * A frame whose height follows its content.
 *
 * A fixed-height frame would clip a diagram or leave a hole under a short one, so the height is measured from
 * the frame's own document. That read is the ONE thing the null origin costs us: `contentDocument` is
 * unreachable cross-origin, so this uses `postMessage` from a script inside the frame — which is exactly why
 * the frame is given `allow-scripts`. Height only; no message from the frame is trusted for anything else.
 */
export function GeneratedFrame({
  html,
  title,
  minHeight = 80,
  maxHeight = 720,
}: {
  /** A complete document body, or an SVG document. */
  html: string;
  title: string;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(minHeight);
  const id = useRef(`f${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { frameId?: string; height?: number } | null;
      // Only accept a height from OUR frame, and only a number. `e.origin` is the string "null" for a
      // sandboxed frame, so it identifies nothing — the id is what ties the message to this frame.
      if (!data || data.frameId !== id.current) return;
      if (typeof data.height !== "number" || !Number.isFinite(data.height)) return;
      setHeight(Math.max(minHeight, Math.min(maxHeight, Math.ceil(data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [minHeight, maxHeight]);

  const bg = "transparent";
  const color = "inherit";
  const srcdoc = wrap(
    `${html}
<script>
  (function () {
    var id = ${JSON.stringify(id.current)};
    function report() {
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      parent.postMessage({ frameId: id, height: h }, "*");
    }
    report();
    // Re-measure when a font or an image settles, since both change the height after first paint.
    window.addEventListener("load", report);
    if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
  })();
<\/script>`,
    bg,
    color,
  );

  return (
    <iframe
      ref={ref}
      className="generated-frame"
      title={title}
      srcDoc={srcdoc}
      // THE ISOLATION. Do not add allow-same-origin: see the header of this file.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ height: `${height}px` }}
    />
  );
}
