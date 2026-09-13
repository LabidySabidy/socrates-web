/**
 * grill.ts — the Socratic dispatch.
 *
 * The original app had a chat pane on the same screen as the concept list, so a click WAS a send
 * (`06cee66^:public/app.js:84`):
 *
 *     row.addEventListener("click", () => chat(`/skill:grill-misconception ${c.name}`));
 *
 * The React app's tray and rail have no composer, so the dispatch has to travel in the route: a click
 * navigates to the lesson carrying the exact same prompt, and the lesson sends it once.
 *
 * The prompt text is the ported mechanism and is NOT configurable — it is what makes a click start a
 * grill rather than open a chat box.
 */

export const GRILL_SKILL = "/skill:grill-misconception";

/** The exact prompt the original posted. */
export function grillPrompt(concept: string): string {
  return `${GRILL_SKILL} ${concept.trim()}`;
}

export function isGrillPrompt(text: string): boolean {
  return text.trim().startsWith(GRILL_SKILL);
}

/** A lesson route carrying a prompt to dispatch on arrival. */
export function grillHref(courseId: string, unit: number, prompt: string): string {
  return `#/lesson/${encodeURIComponent(courseId)}/${unit}?ask=${encodeURIComponent(prompt)}`;
}

/**
 * The `ask` parameter of a hash, or null.
 *
 * Split the query off BEFORE anything else looks at the path: `#/lesson/x/1?ask=…` would otherwise
 * hand `/1?ask=…` to the unit parser and silently fall back to unit 1.
 */
export function splitHash(hash: string): { path: string; params: URLSearchParams } {
  const raw = hash.replace(/^#\/?/, "");
  const cut = raw.indexOf("?");
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const query = cut === -1 ? "" : raw.slice(cut + 1);
  return { path, params: new URLSearchParams(query) };
}

export function parseAsk(hash: string): string | null {
  const ask = splitHash(hash).params.get("ask");
  return ask && ask.trim() ? ask : null;
}
