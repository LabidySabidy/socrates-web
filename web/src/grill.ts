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

import { humanize } from "./humanize.ts";

export const GRILL_SKILL = "/skill:grill-misconception";

/** The exact prompt the original posted. */
export function grillPrompt(concept: string): string {
  return `${GRILL_SKILL} ${concept.trim()}`;
}

export function isGrillPrompt(text: string): boolean {
  return text.trim().startsWith(GRILL_SKILL);
}

/**
 * A lesson route carrying a prompt to dispatch on arrival.
 *
 * This is the general mechanism; `grillHref` is one caller of it. The scaffold dispatch below uses
 * the same route rather than a second one, so there is one way a click can start a session.
 */
export function askHref(courseId: string, unit: number, prompt: string): string {
  return `#/lesson/${encodeURIComponent(courseId)}/${unit}?ask=${encodeURIComponent(prompt)}`;
}

export function grillHref(courseId: string, unit: number, concept: string): string {
  return askHref(courseId, unit, grillPrompt(concept));
}

/**
 * The scaffold dispatch, for a course that was started but never filled in.
 *
 * `/skill:scaffold-learning` is explicit-invocation-only and takes no argument: it interviews the
 * learner. Dispatched bare, from inside the course directory, so the tutor can read MISSION.md.
 */
export const SCAFFOLD_SKILL = "/skill:scaffold-learning";

export function scaffoldPrompt(): string {
  return SCAFFOLD_SKILL;
}

export function scaffoldHref(courseId: string): string {
  return askHref(courseId, 1, scaffoldPrompt());
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

/**
 * Per-module dispatch: what a module row asks the tutor to do.
 *
 * The misconception row already carried an `ask` (its `grillHref`), which is why clicking it starts a
 * session while the Recite and Explain rows silently opened an empty lesson.
 *
 * `recite` is the honest case. The module means "explain this back to me from memory", and the skill for
 * that is `feynman-recite` — which is served in NO configuration (T-058), so dispatching it would point
 * at a skill the tutor cannot load and produce exactly the broken-looking lesson this fixes. It
 * therefore dispatches `grill-misconception`, which IS served and whose first move is to make the learner
 * produce the explanation from memory. Reported rather than hidden: when T-058 is fixed, this is the line
 * to change back.
 */
export function moduleAskHref(courseId: string, unit: number, type: string, concept: string): string | null {
  const label = humanizeConcept(concept);
  switch (type) {
    case "recite":
      return askHref(courseId, unit, `${GRILL_SKILL} ${label} — make me explain it from memory first.`);
    case "explain":
      return askHref(courseId, unit, `${GRILL_SKILL} ${label} — I will explain it in my own words.`);
    case "review":
      return askHref(courseId, unit, `${GRILL_SKILL} ${label} — I am returning to this one, test me.`);
    default:
      return null;
  }
}

/**
 * The concept's display name, for a prompt the LEARNER will see in their own composer.
 *
 * The prompt carries words a person reads, while the tutor matches concept names case-insensitively, so
 * Title Case reaches the tutor and reads correctly to the learner. It imports from `humanize.ts` rather
 * than duplicating the rule — the casing convention lives in one place.
 */
function humanizeConcept(concept: string): string {
  return humanize(concept);
}

/**
 * The opening turn (Step 2a, routing per Step 4d).
 *
 * No lesson could start itself, so learners typed "hey, are you there?" into an empty console. The tutor
 * opens instead, and the ROUTE is deterministic — decided by the learner's actual state, not left to the
 * model's mood:
 *
 *   new concept          -> teach it. Nothing is known yet, so probing would be theatre.
 *   returning mid-progress -> recap what is settled, then probe.
 *   explicit ask          -> that mode; the learner clicked something and named it.
 *
 * Every variant is addressed to the tutor as an instruction, and every variant is one sentence the
 * learner reads as the tutor speaking.
 */
export interface OpeningContext {
  /** The unit's concept, in display case, or null for a unit with no card. */
  concept: string | null;
  mode: "teach" | "recap-then-probe" | "grill";
  /** How many prior sessions touched this concept. */
  priorSessions: number;
  /** The card's badge label, e.g. "Weak". */
  mastery: string | null;
  /** Summaries of misconceptions the learner carried, resolved or not. */
  misconceptions: { id: string; summary: string; sinceResolved: boolean }[];
}

export function openingPrompt(ctx: OpeningContext): string {
  const name = ctx.concept ?? "this unit";

  if (ctx.mode === "teach") {
    // D9 — report #9 (`2026-09-15T05-03-24-251Z-944a3edc`): "seeing BE agent thinking here that i shouldnt be".
    //
    // This used to dispatch `grill-misconception` while ASKING it to explain, and that skill's rule 1 says "Do
    // not explain. Your job is not to teach this turn." The model resolved the contradiction by improvising,
    // and its improvisation — the working it narrates while deciding how to handle an impossible instruction —
    // is what reached the learner. `explain-concept` is allowed to teach, so there is no contradiction to
    // resolve and nothing to leak.
    return [
      `/skill:explain-concept ${name}`,
      "",
      "Teach me this one first. I have not worked on it before.",
      "Give me the smallest true mental model and one concrete example, then ask me something that shows",
      "whether I have it.",
    ].join(" ");
  }

  if (ctx.mode === "recap-then-probe") {
    const prior =
      ctx.priorSessions > 0
        ? `We have worked on ${name} across ${ctx.priorSessions} previous sitting${ctx.priorSessions === 1 ? "" : "s"}`
        : `We have looked at ${name} before`;
    const badge = ctx.mastery ? ` and my last state was ${ctx.mastery}` : "";
    const wrong = ctx.misconceptions.filter((m) => !m.sinceResolved);
    const fixed = ctx.misconceptions.filter((m) => m.sinceResolved);
    const parts = [`${prior}${badge}.`];
    if (wrong.length > 0) {
      parts.push(
        `I still have ${wrong.length === 1 ? "a live misconception" : `${wrong.length} live misconceptions`} on this one — remind me what it was in one line, then test whether I still hold it.`,
      );
    }
    if (fixed.length > 0) {
      parts.push(
        `Check that ${fixed.length === 1 ? "one thing we corrected" : `${fixed.length} things we corrected`} actually stuck.`,
      );
    }
    parts.push("Give me a one-line recap of where I got to, then probe.");
    return `/skill:grill-misconception ${name} ${parts.join(" ")}`;
  }

  return `/skill:grill-misconception ${name}`;
}

/**
 * The same routing rule the server uses (`continuity.ts:lessonMode`), for the client's opening turn.
 *
 * Duplicated deliberately and kept trivial: the server needs the rule for its own recap payload and the
 * client needs it before the tutor is ever asked. It is two conditions, and a shared module would mean
 * shipping continuity.ts's filesystem imports into the browser bundle.
 */
export function lessonModeOf(
  standing: { isNew: boolean; touched: boolean } | null,
  hasHistory: boolean,
): "teach" | "recap-then-probe" {
  if (!standing || standing.isNew) return "teach";
  if (standing.touched || hasHistory) return "recap-then-probe";
  return "teach";
}
