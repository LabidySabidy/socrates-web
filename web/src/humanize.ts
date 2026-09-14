/**
 * humanize.ts — display names, never ids.
 *
 * THE INVARIANT: the app renders display names. A concept's `name` is an identity — it is the telemetry
 * key, the module id stem, and the exact text the grill prompt carries to the tutor — so it is also the
 * text that used to reach the screen, as `wheel-anatomy-and-tension-model`. Every place a name becomes
 * pixels calls this instead.
 *
 * ONE CONVENTION: sentence case. `Wheel anatomy and tension model`, not `Wheel Anatomy And Tension
 * Model`. Title-casing every word is the tell of a machine — it capitalises `And`, `Of` and `From` —
 * and it would make a legacy course read differently from a freshly scaffolded one in the same library,
 * because the skill authors sentence case. Connectives are NOT special-cased: a list of small words to
 * leave lowercase is a maintenance trap and it is always wrong for some title.
 *
 * Applied at render, NEVER at the model boundary: `course-model.ts` builds module ids and grill prompts
 * from the same strings, and humanising those would silently break lookups and telemetry.
 */

/**
 * Turn an identifier into a sentence, and leave authored text alone.
 *
 * The whole rule is one test: **a `-` or `_` means it is an identifier.** There is no other signal — a
 * slugger lowercased everything, so the string itself cannot say what it once was.
 *
 * - Contains `-` or `_` → lowercase it and capitalise only the first word: `wheel-anatomy-and-tension-model`
 *   becomes `Wheel anatomy and tension model`, and `e46-drift-target-spec` becomes `E46 drift target spec`.
 * - No separator → return it unchanged, which is what makes this safe to apply to names the skill (or a
 *   learner) already wrote as words: `Camber and toe` passes through untouched.
 *
 * Idempotent either way, so applying it twice is applying it once.
 *
 * The known limitation, stated rather than hidden: a slugger destroyed casing before this ever ran, so
 * `kpi` becomes `Kpi`. Legacy courses read correctly apart from acronym casing.
 */
export function humanize(name: string): string {
  if (!/[-_]/.test(name)) return name;

  const words = name
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "";

  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}
