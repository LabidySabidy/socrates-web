/**
 * What the learner reads when the tutor fails.
 *
 * THE RULE: the copy names the CAUSE and the NEXT ACTION, and never shows raw provider text. During a
 * multi-hour deepseek outage the learner needs to know three things — this is not their fault, waiting will
 * not help right now, and there is a way back. A request id or an internal phrasing answers none of them.
 *
 * The server sends the provider's raw message; `failureView` turns it into something a person can act on.
 * Raw text still reaches the bug report, which is where it belongs.
 */
import { classifyFailure } from "./turn-result.ts";

export interface FailureView {
  /** Short headline. */
  title: string;
  /** What happened, in plain language. */
  body: string;
  /** Whether retrying now is worth attempting. */
  retryable: boolean;
  /** The label for the retry control. */
  action: string;
}

/**
 * Turn a raw provider failure into learner-facing copy.
 *
 * `retryable: false` on auth is deliberate: offering a button guaranteed to fail is worse than offering none.
 * Everywhere else, retrying is the correct instruction — including during an outage, where the right advice is
 * "try again shortly" rather than a button that pretends the moment is as good as any other.
 */
export function failureView(raw: string): FailureView {
  const kind = classifyFailure(raw);
  switch (kind) {
    case "timeout":
      return {
        title: "The tutor didn't respond in time",
        body: "The model was unreachable for long enough that the request gave up. Nothing you wrote was lost — try again, and it will usually go through.",
        retryable: true,
        action: "Try again",
      };
    case "rate-limit":
      return {
        title: "The tutor is rate-limited",
        body: "Too many requests are hitting the model right now. Waiting a minute or two usually clears it.",
        retryable: true,
        action: "Try again",
      };
    case "outage":
      return {
        title: "The tutor is unavailable",
        body: "The model service looks to be down. This is on the provider's side, not something you did — retrying in a few minutes is the best option.",
        retryable: true,
        action: "Try again",
      };
    case "auth":
      return {
        title: "The tutor can't sign in",
        body: "The model rejected the app's credentials, so retrying will not help. This needs a key or model setting fixed before the tutor can reply.",
        // No retry control: an action guaranteed to fail is worse than no action.
        retryable: false,
        action: "",
      };
    default:
      return {
        title: "The tutor stopped responding",
        body: "Something went wrong before a reply arrived. Your message is still in the box — try again, and if it keeps happening, report it.",
        retryable: true,
        action: "Try again",
      };
  }
}

/**
 * The wait, described honestly.
 *
 * A learner watching a frozen screen cannot tell a slow turn from a dead one, which is precisely how a
 * multi-hour outage read as "the app is broken". Naming the state and the elapsed time is what makes the two
 * distinguishable — and it is why the ceiling is 180s rather than pi's 900s.
 */
export function waitingNotice(elapsedMs: number, retrying?: { attempt: number; maxAttempts: number }): string {
  const secs = Math.max(0, Math.round(elapsedMs / 1000));
  if (retrying) {
    return `The tutor is retrying (attempt ${retrying.attempt} of ${retrying.maxAttempts}) · ${secs}s`;
  }
  if (secs < 5) return "Socrates is thinking…";
  if (secs < 30) return `Socrates is thinking… ${secs}s`;
  return `Still working… ${secs}s. Long waits usually mean the model is struggling — you can wait, or stop and try again.`;
}
