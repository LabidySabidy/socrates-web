/**
 * passivity.ts — the passivity intercept, as a real gate.
 *
 * Recovered from `06cee66^:public/app.js:22-23, 155-163, 182, 247-249`. Two things the audit got
 * wrong, both confirmed against the source:
 *
 *   1. It NEVER blocked submission. The regex only decided whether to HIDE a banner that was already
 *      showing: `if (!isPassiveText(message)) hidePassivity();`
 *   2. The banner was shown by an EXTENSION notification, not by client-side detection:
 *      `if (e.method === "notify" && e.message.includes("PASSIVITY")) showPassivity();`
 *      So the client never diagnosed passivity — the tutor did.
 *
 * REDESIGN, and this is a BEHAVIOUR CHANGE, labelled as one: once the tutor has signalled the
 * intercept, a passive draft can no longer be submitted. A real explanation still can, and sending
 * one clears the intercept.
 */

/** Verbatim from app.js:22-23. */
export const PASSIVE_RE =
  /^(?:ok|okay|k+|cool|got ?it|makes? ?sense|next|proceed|continue|go ?on|y|yes|yeah|sure|fine|right|nice|great|\.+)$/i;

/** The banner copy, verbatim from index.html:94. */
export const PASSIVITY_MESSAGE =
  "⚠️ [PASSIVITY INTERCEPT] Simply nodding along triggers the Illusion of Understanding. " +
  "Actively explain the concept using a plain-English analogy.";

export function isPassiveText(text: string): boolean {
  return PASSIVE_RE.test(text.trim());
}

/**
 * May this draft be submitted?
 *
 * With no intercept active, anything may. With one active, a passive draft is refused — the gate —
 * and a real explanation passes, which is what clears the intercept.
 */
export function maySubmit(interceptActive: boolean, draft: string): boolean {
  if (!draft.trim()) return false;
  if (!interceptActive) return true;
  return !isPassiveText(draft);
}

/** Why a draft was refused, for the UI to say something useful rather than just disabling a button. */
export function refusalReason(interceptActive: boolean, draft: string): string | null {
  if (!interceptActive) return null;
  if (!draft.trim()) return null;
  return isPassiveText(draft) ? "passive" : null;
}

/**
 * Does this stream line carry the tutor's passivity signal?
 * Ported from the extension-notification branch: `e.message.includes("PASSIVITY")`.
 */
export function isPassivitySignal(event: unknown): boolean {
  const e = event as { type?: unknown; method?: unknown; message?: unknown } | null;
  if (!e || e.type !== "extension_ui_request" || e.method !== "notify") return false;
  return typeof e.message === "string" && e.message.includes("PASSIVITY");
}
