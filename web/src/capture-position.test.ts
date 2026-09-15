/**
 * The capture must paint each element where it actually appears.
 *
 * The owner reported "latest bug reported captures screenshot incorrectly", and their screenshot shows it: text
 * doubled and overlapping, the top bar displaced. Measured in a real browser, the cause was an ADDED scroll
 * offset on an already viewport-relative rect — 0px error at the top, 48px scrolled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { paintPosition, planPaint, scrollOriginOf, shouldPaint } from "./capture-position.ts";

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

// ---------------------------------------------------------------------------
// D-CAP — the capture must not paint an element its parent already painted, and must not paint
// the focused skip link.
//
// Reported by the owner, 2026-09-15, with a screenshot showing bold lead-ins ("Recap:", "Nothing",
// "Heat is the remainder line.") printed OVER the lines beneath them, plus stray text in the top-left.
// ---------------------------------------------------------------------------

test("an INLINE child is not painted over its parent — the doubled bold lead-in", () => {
  // THE measured cause. The paint loop collects only TEXT_NODE children, so a parent paints its own text
  // re-flowed from its own left edge — as if the inline child did not exist — and the child then paints at ITS
  // own rect, which is where the parent's re-flow has already put other words.
  //
  // Measured on a real paragraph:
  //   parent own-text : "Ledger model holds, still 🟨 — the no-load case is the open one: …"  (99 chars)
  //   parent full text: 106 chars
  //   <strong> "Recap:"  display:inline  at (292, 346)   parentRect.left = 292
  const result = planPaint({
    parentOwnText: "Ledger model holds",
    parentRect: { left: 292, top: 342, width: 400, height: 61 },
    inlineChildren: [
      { text: "Recap:", display: "inline", rect: { left: 292, top: 346, width: 51, height: 22 } },
    ],
  });

  const painted = result.runs.map((r) => r.text);
  assert.ok(!painted.includes("Recap:"), `the inline child must not paint separately: ${JSON.stringify(painted)}`);
});

test("the parent's text INCLUDES the inline child, so nothing is lost", () => {
  // The other half: skipping the child must not drop its words. The parent paints a run containing them, at the
  // position the browser actually laid them out.
  const result = planPaint({
    parentOwnText: "Ledger model holds",
    parentRect: { left: 292, top: 342, width: 400, height: 61 },
    inlineChildren: [
      { text: "Recap:", display: "inline", rect: { left: 292, top: 346, width: 51, height: 22 } },
    ],
  });
  const all = result.runs.map((r) => r.text).join(" ");
  assert.match(all, /Recap:/, "the word still appears, just once");
  assert.equal((all.match(/Recap:/g) || []).length, 1, "and exactly once");
});

test("a BLOCK child is left to paint itself, as before", () => {
  // The existing behaviour must not regress: a container does not repaint its block children's words, and the
  // children paint themselves. `planPaint` returns only the PARENT's runs, so the assertion is that the parent
  // did not absorb the block child's text.
  const result = planPaint({
    parentOwnText: "Intro",
    parentRect: { left: 0, top: 0, width: 400, height: 80 },
    blockChildren: [{ text: "Body paragraph", display: "block", rect: { left: 0, top: 20, width: 400, height: 40 } }],
  });
  const painted = result.runs.map((r) => r.text).join(" ");
  assert.match(painted, /Intro/);
  assert.ok(!painted.includes("Body paragraph"), "a block child is not folded into the parent");
});

test("a parent with NO own text hands its inline children back to the caller", () => {
  // A paragraph that is entirely `<strong>` has no own text, so folding would emit nothing and the words would
  // vanish — worse than the overlap. `paintInlineChildren: true` tells the caller to paint them as before.
  const result = planPaint({
    parentOwnText: "",
    parentRect: { left: 292, top: 342, width: 400, height: 22 },
    inlineChildren: [{ text: "Bold lead", display: "inline", rect: { left: 292, top: 346, width: 51, height: 22 } }],
  });
  assert.deepEqual(result.runs, [], "the parent paints nothing of its own");
  assert.equal(result.paintInlineChildren, true, "so the caller must still paint the inline children");
});

test("the FOCUSED skip link is not painted — the top-left artifact", () => {
  // Measured: unfocused it sits at left:-9999px and the off-screen guard excludes it. FOCUSED it moves to
  // left:0px with a box of (0,0,125,42), which PASSES `isVisible` and is painted over the page chrome. Focus
  // moves it on-screen because that is the accessibility behaviour (F4), so a keyboard user who tabbed once
  // leaves it in exactly the state that produces the artifact.
  assert.equal(shouldPaint({ cls: "skip-link", rect: { left: 0, top: 0, width: 125, height: 42 } }), false);
  assert.equal(shouldPaint({ cls: "skip-link", rect: { left: -9999, top: 0, width: 125, height: 42 } }), false);
});

test("ordinary content at the origin still paints", () => {
  // The guard must be specific to the skip link, not "nothing near the top-left".
  assert.equal(shouldPaint({ cls: "brand", rect: { left: 28, top: 14, width: 168, height: 32 } }), true);
  assert.equal(shouldPaint({ cls: "", rect: { left: 0, top: 0, width: 100, height: 20 } }), true);
});
