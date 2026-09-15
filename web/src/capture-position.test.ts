/**
 * The capture must paint each element where it actually appears.
 *
 * The owner reported "latest bug reported captures screenshot incorrectly", and their screenshot shows it: text
 * doubled and overlapping, the top bar displaced. Measured in a real browser, the cause was an ADDED scroll
 * offset on an already viewport-relative rect — 0px error at the top, 48px scrolled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { paintPosition, scrollOriginOf } from "./capture-position.ts";

test("an element is painted at its VIEWPORT-RELATIVE position, with no scroll added", () => {
  // The defect in one assertion: the old code returned left + scrollLeft.
  const scrolled = { left: 12, top: 40 };
  assert.deepEqual(paintPosition(scrolled), { x: 12, y: 40 });
});

test("the same rect paints to the same place regardless of scroll — the old bug", () => {
  // A rect is already viewport-relative, so it does not move when the page scrolls: scrolling CHANGES the rect.
  // The old code added the scroll on top of the changed rect, double-counting it.
  const rect = { left: 0, top: 552 };
  const a = paintPosition(rect);
  const b = paintPosition(rect);
  assert.deepEqual(a, b, "painting must be a pure function of the measured rect");
});

// --- the nearest scrollable ancestor -------------------------------------------------------------
// A minimal fake DOM: enough of Element/Window for the walk, with no browser and no dependency.

function fakeWindow(scrollables: Record<string, { scrollTop: number; scrollLeft: number }>) {
  return {
    getComputedStyle(node: { __id: string }) {
      const s = scrollables[node.__id];
      return {
        overflowY: s ? "auto" : "visible",
        overflowX: s ? "auto" : "visible",
      } as CSSStyleDeclaration;
    },
  } as unknown as Window;
}

function chain(ids: string[]) {
  // Build body > a > b > … > leaf, each with client/scroll sizes making it scrollable only if declared.
  // `documentElement` carries scroll fields because the fallback reads them — a fixture missing them made a
  // test look like a code failure (`undefined`) rather than an incomplete fake.
  const documentElement = { scrollLeft: 0, scrollTop: 0 };
  const nodes = ids.map((id) => ({
    __id: id,
    parentElement: null as unknown,
    ownerDocument: { body: {} as unknown, documentElement },
    scrollHeight: 1000,
    clientHeight: 500,
    scrollWidth: 1000,
    clientWidth: 500,
    scrollTop: 0,
    scrollLeft: 0,
  }));
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].parentElement = nodes[i + 1];
  const leaf = nodes[0];
  const body = nodes[nodes.length - 1];
  for (const n of nodes) n.ownerDocument.body = body;
  return { leaf, body, documentElement };
}

test("the scroll origin comes from the NEAREST scrollable ancestor, not the document", () => {
  // The real layout: the lesson scrolls in an inner pane while the document reports a smaller value. A
  // document-only read under-corrects on the owner's own page.
  const { leaf, documentElement } = chain(["leaf", "inner", "body"]);
  documentElement.scrollTop = 5; // the document barely moved
  (leaf.parentElement as { scrollTop: number }).scrollTop = 480; // the pane holds the real offset

  const win = fakeWindow({ inner: { scrollTop: 480, scrollLeft: 0 } });
  const origin = scrollOriginOf(leaf as unknown as Element, win);
  assert.equal(origin.scrollTop, 480, "the pane's offset is used, not the document's 5px");
});

test("with nothing scrollable in between, it falls back to the document", () => {
  const { leaf, documentElement } = chain(["leaf", "plain", "body"]);
  documentElement.scrollTop = 120;
  documentElement.scrollLeft = 3;

  const win = fakeWindow({});
  const origin = scrollOriginOf(leaf as unknown as Element, win);
  assert.deepEqual(origin, { scrollLeft: 3, scrollTop: 120 });
});

test("a non-scrollable ancestor is skipped even when it overflows", () => {
  // Guarding on computed overflow, not merely on sizes: a `visible` overflow with tall content is not
  // scrollable, and treating it as the origin would read 0 and silently drop the real offset.
  const { leaf, documentElement } = chain(["leaf", "tall", "body"]);
  documentElement.scrollTop = 77;
  const win = fakeWindow({}); // nothing declared scrollable
  assert.equal(scrollOriginOf(leaf as unknown as Element, win).scrollTop, 77);
});
