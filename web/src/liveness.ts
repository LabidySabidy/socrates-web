/**
 * Is the tutor alive?
 *
 * THE PROBLEM THIS SOLVES. A learner watching a frozen screen cannot tell a slow turn from a dead one. During
 * a multi-hour deepseek outage the tutor emitted NOTHING — no text, no reasoning, no tool call — for the full
 * 900s idle timeout, so the UI sat on an unchanging "Socrates is thinking…" and the app read as broken. The
 * failure was real; the silence was the defect.
 *
 * The state is derived from when output last arrived, not from a timer alone, so a turn that is streaming is
 * never called stalled no matter how long it runs — a long legitimate turn and a dead provider must not look
 * the same.
 */

/**
 * `working`  — output arrived recently.
 * `quiet`    — nothing for a while, but still within what a slow model can do.
 * `stalled`  — silence past the point where patience is reasonable. Surfaced, NOT auto-failed: the learner
 *              keeps the turn until the ceiling, and is told what is happening meanwhile.
 */
export type Liveness = "working" | "quiet" | "stalled";

export interface LivenessInput {
  /** Milliseconds since the turn started. */
  elapsedMs: number;
  /** Milliseconds since the LAST piece of output (text, reasoning, or a tool call). */
  sinceOutputMs: number;
  /** A retry is in flight, per pi's `auto_retry_start`. */
  retrying?: boolean;
}

/** Silence past this is reported as stalled. Well inside the 180s ceiling, so it is a warning, not the end. */
export const STALLED_AFTER_MS = 45_000;
/** Silence past this, with no output at all, is described more strongly — the provider looks dead. */
export const DEAD_AFTER_MS = 120_000;

export function liveness(input: LivenessInput): Liveness {
  // A retry in flight means the tutor tried and the provider refused. That is not "working" — saying so would
  // hide the very condition the learner needs to know about.
  if (input.retrying) {
    return input.sinceOutputMs >= STALLED_AFTER_MS ? "stalled" : "quiet";
  }
  if (input.sinceOutputMs < STALLED_AFTER_MS) return "working";
  return "stalled";
}

/**
 * How the wait is described, combining elapsed time with the liveness state.
 *
 * Deliberately avoids the word "failed" — the turn is still running until the ceiling. Telling a learner it
 * failed and then delivering a reply is worse than telling them it is slow.
 */
export function describeWait(input: LivenessInput): string {
  const secs = Math.round(input.elapsedMs / 1000);
  const state = liveness(input);

  if (input.retrying) {
    return state === "stalled"
      ? `Still retrying after ${secs}s — the model may be having trouble. You can keep waiting or try again.`
      : `Retrying with the tutor… ${secs}s`;
  }
  if (state === "working") {
    return secs < 5 ? "Socrates is thinking…" : `Socrates is thinking… ${secs}s`;
  }
  // stalled
  if (input.sinceOutputMs >= DEAD_AFTER_MS) {
    return `No response after ${secs}s. The model service may be down — you can wait, or stop and try again shortly.`;
  }
  return `Still working… ${secs}s with nothing new. Long silences usually mean the model is struggling.`;
}
