/**
 * Where to paint an element in a capture.
 *
 * THE DEFECT THIS FIXES. The capture painted `x = rect.left + scrollLeft` while `getBoundingClientRect()` is
 * ALREADY viewport-relative. Every element was therefore offset by exactly the scroll position — measured in a
 * real browser: 0px error at the top of the page, 48px when scrolled. That is the doubled, overlapping text in
 * the owner's bug-report screenshots.
 *
 * The second half of the fix matters as much as the first: the real lesson scrolls inside an INNER PANE, so
 * the document reported `scrollTop 48` while the pane held the rest. Reading only `documentElement` would have
 * under-corrected on the owner's own layout.
 *
 * These functions are separated from `capture.ts` so they are testable without a canvas — the reason the
 * original defect survived was that the only way to check it was to look at a picture.
 */

/** The element whose `scrollLeft/scrollTop` actually moves the content, nearest-first. */
export interface ScrollAncestor {
  scrollLeft: number;
  scrollTop: number;
}

/**
 * Find the nearest scrollable ancestor of `el`, falling back to the document scrolling element.
 *
 * Walks from the element outward, because in this app the scrolling container is an inner pane
 * (`.lesson-scroll`) and NOT the document — a document-only read is measurably wrong here.
 */
export function scrollOriginOf(el: Element, win: Window = window): ScrollAncestor {
  let node: Element | null = el.parentElement;
  while (node && node !== el.ownerDocument.body) {
    const style = win.getComputedStyle(node);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const scrollableY = (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && node.scrollHeight > node.clientHeight;
    const scrollableX = (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") && node.scrollWidth > node.clientWidth;
    if (scrollableY || scrollableX) {
      return { scrollLeft: scrollableX ? node.scrollLeft : 0, scrollTop: scrollableY ? node.scrollTop : 0 };
    }
    node = node.parentElement;
  }
  const doc = el.ownerDocument.documentElement;
  return { scrollLeft: doc.scrollLeft, scrollTop: doc.scrollTop };
}

/**
 * The position to paint an element at, inside a canvas that is `scale`-independent and viewport-relative.
 *
 * IMPORTANT: no scroll offset is added. `getBoundingClientRect()` is already relative to the viewport, which
 * is the coordinate space a capture draws in; adding the scroll was the whole defect. The scroll origin is
 * still needed — but for the CANVAS ORIGIN, not for each element (see `captureOrigin`).
 */
export function paintPosition(rect: { left: number; top: number }): { x: number; y: number } {
  return { x: rect.left, y: rect.top };
}

/**
 * The offset to apply ONCE to the whole canvas, so the capture shows the content the reporter is looking at.
 *
 * Applied per-capture rather than per-element: adding it to each element is what produced the doubled text,
 * because the elements already carry it in their viewport-relative rects.
 */
export function captureOrigin(el: Element, win: Window = window): ScrollAncestor {
  return scrollOriginOf(el, win);
}

// ---------------------------------------------------------------------------
// What to paint, and where.
//
// The paint loop in `capture.ts` needs two decisions that a screenshot kept getting wrong, so they live here as
// pure functions with the measured rects as fixtures.
// ---------------------------------------------------------------------------

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaintRun {
  text: string;
  x: number;
  y: number;
}

export interface PaintPlanInput {
  /**
   * The element's OWN text, from `TEXT_NODE` children only — which is what the loop already gathers, and which
   * EXCLUDES any inline child's words.
   */
  parentOwnText: string;
  parentRect: Box;
  /** Inline children (e.g. `<strong>`, `<em>`, `<code>`) whose text the parent's re-flow will place. */
  inlineChildren?: { text: string; display: string; rect: Box }[];
  /** Block children, which paint themselves as separate elements. */
  blockChildren?: { text: string; display: string; rect: Box }[];
}

/**
 * Decide which text runs to paint for one element, and where.
 *
 * THE DEFECT. A parent gathers only its own `TEXT_NODE` children, so it paints "Ledger model holds…" as though
 * its `<strong>Recap:</strong>` did not exist — re-flowed from its own left edge. The `<strong>` then paints
 * "Recap:" at its own rect, which is exactly where the parent's re-flow has already put other words. Every
 * doubled phrase in the owner's screenshot is this: a bold lead-in printed over the line beneath it.
 *
 * THE FIX, in two parts:
 *
 *  1. When the element has own text, an INLINE child's words are folded into the parent's run instead of being
 *     painted separately. The words appear once, and the parent's re-flow puts them where the browser did.
 *  2. When the element has NO own text — a paragraph that is entirely `<strong>` — the inline child is painted
 *     by the caller as before, because nothing else would draw it. Swallowing it would lose the words, which is
 *     worse than the overlap.
 *
 * BLOCK children are untouched: they still paint separately, which is the behaviour that already worked.
 */
export function planPaint(input: PaintPlanInput): { runs: PaintRun[]; paintInlineChildren: boolean } {
  const runs: PaintRun[] = [];
  const hasOwnText = input.parentOwnText.trim().length > 0;

  if (hasOwnText) {
    // Fold the inline children's words in, in document order, so nothing is lost and nothing is doubled.
    const inline = input.inlineChildren ?? [];
    const text = inline.length > 0 ? `${input.parentOwnText} ${inline.map((c) => c.text.trim()).join(" ")}`.trim() : input.parentOwnText;
    runs.push({ text, x: input.parentRect.left, y: input.parentRect.top });
  }

  return { runs, paintInlineChildren: !hasOwnText };
}

/**
 * Should this element be painted at all?
 *
 * SPECIFIC rules, not a broad one, because "nothing near the top-left" would drop real content.
 *
 * The skip link is the measured case. Unfocused it sits at `left: -9999px` and the off-screen guard already
 * excludes it. FOCUSED it moves to `left: 0px` with a box of (0,0,125,42), which passes every existing check —
 * so a keyboard user who tabbed once leaves it in the state that paints "Skip to content" over the page chrome.
 * It is a navigation aid, not part of the page being reported.
 */
export function shouldPaint(opts: { cls: string; rect: Box }): boolean {
  const classes = opts.cls.split(/\s+/).filter(Boolean);
  // The skip link, by class. Checked by class rather than position so a real element at the origin still paints.
  if (classes.includes("skip-link")) return false;
  const { width, height } = opts.rect;
  if (width <= 0 || height <= 0) return false;
  return true;
}
