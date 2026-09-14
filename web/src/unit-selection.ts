/**
 * unit-selection.ts — which unit is on screen, and what the label may say.
 *
 * G2. Two lines disagreed: `LessonPage` fell back to `units[0]` when the requested unit was not found,
 * while the breadcrumb printed the RAW route param. So `#/lesson/<course>/99` showed unit 1's content under
 * the label "Unit 99" — and `1e21` reached the label as "1e+21", because the router accepts any finite
 * positive number as a unit.
 *
 * The distinction that was missing: **no unit asked for** and **a unit that does not exist** are different
 * things. The first legitimately defaults to the first unit (`#/lesson/<course>` is a real link target).
 * The second is a request for something that is not there, and substituting a different unit under a label
 * claiming otherwise is a lie about which unit the learner is reading.
 *
 * This is the pure decision, so the rule is testable without a DOM.
 */

export interface UnitLike {
  n: number;
  title: string;
}

export type UnitResolution<U extends UnitLike> =
  | { kind: "found"; unit: U }
  | { kind: "default"; unit: U }
  | { kind: "out-of-range"; requested: number; available: number[] }
  | { kind: "empty" };

/**
 * A value safe to put in a label.
 *
 * The router passes through anything finite and positive, which includes `1e21` (renders as "1e+21") and
 * `2.5` (not a unit number at all). A label must never show exponential notation or a fraction, so the
 * requested value is normalised before it is reported: an integer inside a printable range, or nothing.
 */
const PRINTABLE_LIMIT = 1_000_000;

function printable(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isInteger(value)) return 0;
  if (Math.abs(value) >= PRINTABLE_LIMIT) return 0;
  return value;
}

/**
 * Decide what the lesson should show.
 *
 * `requested` is `undefined` when the URL names no unit — that is the case that keeps the first-unit
 * default. Everything else must be a unit that actually exists, or an explicit out-of-range result.
 */
export function resolveUnit<U extends UnitLike>(
  units: U[],
  requested: number | undefined,
): UnitResolution<U> {
  if (units.length === 0) return { kind: "empty" };

  // No unit asked for: default to the first, deliberately. `#/lesson/<course>` relies on this.
  if (requested === undefined) return { kind: "default", unit: units[0] };

  const found = units.find((u) => u.n === requested);
  if (found) return { kind: "found", unit: found };

  return {
    kind: "out-of-range",
    // Normalised: 1e21 and 2.5 must not reach a label as "1e+21" or "2.5". Zero means "no sensible number
    // to show", and the caller renders generic copy rather than a number.
    requested: printable(requested),
    available: units.map((u) => u.n),
  };
}
