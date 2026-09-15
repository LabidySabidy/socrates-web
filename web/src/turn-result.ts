/**
 * The turn outcome — what happened, in a form the client can render.
 *
 * WHY THIS EXISTS. The app consumed exactly one pi event class (`assistantMessageEvent.delta`) and threw the
 * rest of the payload away. When deepseek was down for hours, pi emitted
 * `auto_retry_end {success: false, finalError: "…900-second timeout limit…"}` and the app rendered nothing —
 * "Socrates is thinking…" for forty-five minutes. The failure was never missing; it was being discarded.
 *
 * The classification lives HERE, separately from the server, so it is testable without a live pi process and
 * without a fake one. `server.ts` feeds it lines and forwards the result.
 */

/** What a finished turn produced. */
export interface TurnOutcome {
  /** Text the tutor streamed. May be non-empty even when the turn also failed. */
  text: string;
  /** Learner-facing failure, when the turn did not succeed. */
  error?: string;
  /** A retry is in flight — the turn has not failed, but it is retrying. */
  retrying?: { attempt: number; maxAttempts: number; reason?: string };
}

/** Which provider-side condition a raw message describes. */
export type FailureKind = "timeout" | "rate-limit" | "auth" | "outage" | "unknown";

/**
 * Classify a provider error message.
 *
 * Raw provider text is for the BUG REPORT, not the chat: request ids and internal phrasing are noise to a
 * learner. The kind decides the copy; the raw text is kept alongside it.
 */
export function classifyFailure(raw: string): FailureKind {
  const s = raw.toLowerCase();
  // Order matters: a rate-limit body often contains the word "timeout", so the specific cases come first.
  if (/429|rate.?limit|too many requests|quota|overloaded/.test(s)) return "rate-limit";
  if (/401|403|api.?key|unauthor|invalid.*key|authentication/.test(s)) return "auth";
  if (/timed? ?out|timeout limit|etimedout|took too long/.test(s)) return "timeout";
  if (/5\d\d|bad gateway|unavailable|service unavailable|connection|econnrefused|enotfound|network|dial/.test(s)) {
    return "outage";
  }
  return "unknown";
}

/** Was this a retry starting, a retry ending, or a failed message? */
interface PiEvent {
  type?: string;
  success?: boolean;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
  message?: { role?: string; stopReason?: string; errorMessage?: string };
  assistantMessageEvent?: { type?: string; delta?: unknown };
}

/**
 * Fold one line from pi's stream into the running outcome.
 *
 * PURE, and returns a NEW object, so the caller keeps no hidden state and the transition is directly testable.
 *
 * THREE SOURCES OF FAILURE, and all three must be read:
 *
 *  1. `message_update` carrying a message whose `stopReason` is `"error"`. Pi puts the WHOLE message on the
 *     wire (`agent-session.js:418`), so this arrives even when no retry happens.
 *  2. `auto_retry_end {success:false}` — the terminal failure after retries are exhausted, carrying
 *     `finalError`. This is the one that fired four times during the deepseek outage.
 *  3. Neither of the above, but the turn ends with no text at all. Handled by the caller, which knows the
 *     turn ended.
 *
 * Reading only (2) is the CRITICAL trap: it is guarded by `_retryAttempt > 0`, so a FIRST-attempt
 * non-retryable error (bad key, bad model) emits no retry events whatsoever and would stay silent.
 */
export function foldLine(outcome: TurnOutcome, line: string): TurnOutcome {
  let evt: PiEvent;
  try {
    evt = JSON.parse(line) as PiEvent;
  } catch {
    return outcome; // not JSON — not part of the turn
  }

  // (1) The failed message itself. Carries `errorMessage` whether or not a retry followed.
  const msg = evt.message;
  if (evt.type === "message_update" || evt.type === "message_end") {
    if (msg?.role === "assistant" && msg.stopReason === "error" && msg.errorMessage) {
      return { ...outcome, error: msg.errorMessage };
    }
  }

  // (3) A retry is in flight. NOT a failure — the turn is still live, and the client should say so rather
  // than show an unchanging spinner.
  if (evt.type === "auto_retry_start") {
    return {
      ...outcome,
      retrying: {
        attempt: typeof evt.attempt === "number" ? evt.attempt : 1,
        maxAttempts: typeof evt.maxAttempts === "number" ? evt.maxAttempts : 1,
        ...(evt.errorMessage ? { reason: evt.errorMessage } : {}),
      },
    };
  }

  // (2) Retries exhausted. This is the terminal failure and carries the provider's own text.
  if (evt.type === "auto_retry_end" && evt.success === false) {
    return {
      ...outcome,
      error: evt.finalError ?? outcome.error ?? "the tutor stopped retrying",
    };
  }

  // A retry that SUCCEEDED clears the in-flight notice, so a recovered turn does not keep claiming to retry.
  if (evt.type === "auto_retry_end" && evt.success === true) {
    const { retrying: _drop, ...rest } = outcome;
    return rest;
  }

  return outcome;
}

/** Append a streamed text delta. Kept here so text and error are folded in one place. */
export function foldText(outcome: TurnOutcome, delta: string): TurnOutcome {
  return { ...outcome, text: outcome.text + delta };
}
