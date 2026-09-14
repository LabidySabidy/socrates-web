/**
 * humanize.ts — display names, never ids.
 *
 * THE INVARIANT: the app renders display names. A concept's `name` is an identity — it is the telemetry
 * key, the module id stem, and the exact text the grill prompt carries to the tutor — so it is also the
 * text that used to reach the screen, as `wheel-anatomy-and-tension-model`. Every place a name becomes
 * pixels calls this instead.
 *
 * ONE CONVENTION: Title Case, for identifiers and for authored text alike. Applying it to both is the
 * point: a course whose headings were written before this convention existed must not read differently
 * from one scaffolded after it. `Wheel Anatomy And Tension Model` on every screen.
 *
 * Applied at render, NEVER at the model boundary: `course-model.ts` builds module ids and grill prompts
 * from the same strings, and humanising those would silently break lookups and telemetry.
 */

/**
 * One word, cased.
 *
 * **A word carrying internal case is deliberate, so it is left alone.** An uppercase letter after the
 * first character means somebody typed that casing on purpose — `useState`, `iPhone`, `KPI`, `McDonald`.
 * Everything else is capitalised and lowercased, which is what turns `kpi` into `Kpi` and `E46` stays
 * `E46` (nothing to lowercase).
 *
 * This is the whole of the "cleverness", and it is a property of the word rather than a list of words: no
 * acronym dictionary, and no small-word list for connectives. `And` and `Of` are capitalised like any
 * other word — proper title case would need such a list, and that is a separate decision if it is ever
 * wanted.
 */
function titleWord(word: string): string {
  if (/[A-Z]/.test(word.slice(1))) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Turn an identifier or an authored name into Title Case.
 *
 * Splits on `-`, `_` and whitespace, so `wheel-anatomy-and-tension-model` and `Wheel anatomy and tension
 * model` converge on the same output — which is the property that makes the two layers agree.
 * Idempotent: applying it twice is applying it once.
 *
 * The known limitation, stated rather than hidden: casing a slugger already destroyed cannot come back,
 * so a single-word lowercase slug is indistinguishable from a lowercase word and `kpi` becomes `Kpi`
 * rather than `KPI`. The fix for that is authoring, not guessing.
 */
export function humanize(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map(titleWord)
    .join(" ");
}
