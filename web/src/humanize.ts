/**
 * humanize.ts — display names, never ids.
 *
 * THE INVARIANT: the app renders display names. A concept's `name` is an identity — it is the telemetry
 * key, the module id stem, and the exact text the grill prompt carries to the tutor — so it is also the
 * text that used to reach the screen, as `wheel-anatomy-and-tension-model`. Every place a name becomes
 * pixels calls this instead.
 *
 * It is deliberately dumb. No acronym dictionary, no title-casing rules, no special cases: those need
 * maintenance, and a wrong expansion ("Kpi" → "Key Performance Indicator") is worse than a plain one.
 * The real fix for casing is authoring names as words in the first place (see the scaffold skill), which
 * is why this is the *display* half of a two-layer change and not a migration.
 *
 * Applied at render, NEVER at the model boundary: `course-model.ts` builds module ids and grill prompts
 * from the same strings, and humanising those would silently break lookups and telemetry.
 */

/**
 * Turn an identifier into words: split on `-` and `_`, capitalise each word, join with spaces.
 *
 * A word is a separator-delimited chunk, so text a human already wrote passes through UNCHANGED —
 * "Camber and toe" is one word and only its first letter is touched. That is what makes the function
 * safe for both layers at once: it converts slugs, and it cannot mangle authored names, which is
 * stronger than merely being stable under re-application.
 *
 * The known limitation, stated rather than hidden: a slugger destroyed casing before this ever ran, so
 * `kpi` becomes `Kpi`. Legacy courses read correctly apart from acronym casing.
 */
export function humanize(name: string): string {
  return name
    .trim()
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
