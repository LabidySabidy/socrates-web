/**
 * G2 — an out-of-range unit must not show a false label.
 *
 * Two lines disagreed: the unit lookup fell back to `units[0]` silently, while the breadcrumb printed the
 * raw route param. So `#/lesson/<course>/99` rendered "Unit 99" above unit 1's content, and `1e21` reached
 * the label as "1e+21" because the router accepts any finite positive number.
 *
 * This is the pure half: given a requested unit and the units that exist, decide what to show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUnit } from "./unit-selection.ts";

const units = [
  { n: 1, title: "Alpha" },
  { n: 2, title: "Beta" },
  { n: 3, title: "Gamma" },
];

test("a unit that exists is selected as itself", () => {
  const r = resolveUnit(units, 2);
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" ? r.unit.n : null, 2);
});

test("an out-of-range unit is NOT silently replaced by the first unit", () => {
  // The defect: unit 1's content rendered under a label claiming to be another unit.
  const r = resolveUnit(units, 99);
  assert.notEqual(r.kind, "found", "unit 99 must not resolve to a unit that is not 99");
  assert.equal(r.kind, "out-of-range");
  assert.equal(r.kind === "out-of-range" ? r.requested : null, 99, "it reports what was asked for");
});

test("the label can never print a number the course does not have", () => {
  for (const requested of [99, 1e9, 1e21, 2.5, -1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = resolveUnit(units, requested);
    assert.notEqual(r.kind, "found", `${requested} must not resolve to an existing unit`);
    // Whatever it reports as the requested value, it must be safe to render.
    if (r.kind === "out-of-range") {
      assert.ok(
        Number.isInteger(r.requested) && Math.abs(r.requested) < 1e6,
        `${requested} would render as ${r.requested} — exponential or non-integer text must not reach a label`,
      );
    }
  }
});

test("a missing unit still defaults to the first — the fallback is kept deliberately", () => {
  // `#/lesson/<course>` has no unit, and several links rely on landing on the first one. The fix must
  // distinguish "no unit asked for" from "a unit that does not exist".
  const r = resolveUnit(units, undefined);
  assert.equal(r.kind, "default");
  assert.equal(r.kind === "default" ? r.unit.n : null, 1);
});

test("a course with no units degrades rather than throwing", () => {
  const r = resolveUnit([], 1);
  assert.equal(r.kind, "empty");
});
