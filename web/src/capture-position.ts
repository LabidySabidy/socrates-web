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
