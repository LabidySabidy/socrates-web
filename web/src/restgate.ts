/**
 * restgate.ts — the cognitive sprint gate.
 *
 * Ported from `06cee66^:public/app.js:25, 126-151, 265-268`. The tutor emits a token inside its
 * streamed reply; the client detects it, stops showing the rest of that message, freezes the composer
 * and counts 5:00 down. There is no backend state of any kind.
 *
 * One deliberate robustness fix over the original: it tested each `text_delta` in isolation
 * (`hasGateToken(d.delta)`), so a token split across two deltas was missed entirely. This checks the
 * accumulated prose instead, which is identical when the token arrives whole and correct when it
 * straddles a chunk boundary.
 */

/** Seconds the gate holds the learner, verbatim from the original (`let remaining = 5 * 60`). */
export const REST_SECONDS = 5 * 60;

/** Verbatim from `app.js:25`. */
export const GATE_TOKENS = ["COGNITIVE SPRINT GATE", "SPRINT_GATE", "SPRINT GATE"] as const;

/** The copy shown behind the scrim, verbatim from `index.html:114-115`. */
export const REST_HEADING = "Cognitive Rest Gate";
export const REST_BODY =
  "You have been studying for 30 minutes. Step away — your hippocampus needs rest to consolidate " +
  "transitory memory into durable schemas. Make a tea and return when the clock ends.";

/** The token present in the text, earliest-first, or null. */
export function findGateToken(text: string): string | null {
  let best: { token: string; at: number } | null = null;
  for (const token of GATE_TOKENS) {
    const at = text.indexOf(token);
    if (at === -1) continue;
    if (!best || at < best.at) best = { token, at };
  }
  return best?.token ?? null;
}

/**
 * Split prose at the gate token.
 *
 * The token is a control signal, not content: everything from it onward is suppressed rather than
 * rendered, which is why this returns the text BEFORE it rather than a boolean.
 */
export function splitAtGate(text: string): { prose: string; token: string | null } {
  const token = findGateToken(text);
  if (!token) return { prose: text, token: null };
  return { prose: text.slice(0, text.indexOf(token)).trimEnd(), token };
}

/** `mm:ss`, exactly as the original formatted it. */
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(clamped / 60)).padStart(2, "0");
  const s = String(clamped % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** True while the gate should hold the learner: the composer is frozen, not merely warned. */
export function isFrozen(open: boolean, remaining: number): boolean {
  return open && remaining > 0;
}
