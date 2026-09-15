/**
 * Strip telemetry blocks from the LIVE text stream.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT THE EXTENSION'S JOB. `pi/extensions/learning` already removes the tag on
 * `message_end`, and pi applies that replacement. But `message_end` fires after the model finishes, while
 * `text_delta` events reach the browser during generation — so the learner sees the tag and the cleanup is too
 * late. The strip has to happen on the same channel the learner is watching.
 *
 * DELTAS ARRIVE AT ARBITRARY BOUNDARIES. Measured: a per-delta `replace` fails 3 of 4 split cases, including
 * `["text <learning-tele", "metry>…</learning-telemetry>"]` which strips nothing at all. So this holds back a
 * partial tag and emits it only once it is known to be complete or known not to be a tag.
 *
 * The stateful handle makes that possible: a pure function cannot hold the partial.
 */

const OPEN = "<learning-telemetry>";
const CLOSE = "</learning-telemetry>";

/**
 * How much text to hold back while waiting to see whether a partial tag completes.
 *
 * Bounded by the longest prefix of `OPEN` that could still become a tag — one character less than the opening
 * tag itself. A longer hold would delay ordinary prose, which costs the responsiveness the owner asked for.
 */
const MAX_HOLD = OPEN.length - 1;

export interface TelemetryStripper {
  /** Feed a delta; returns the text that is safe to show now (may be empty). */
  (delta: string): string;
  /** Release anything still held — call at end of turn so a truncated reply is not silently eaten. */
  flush(): string;
  /**
   * The telemetry payloads that were removed, in order. Used to render a real notice instead of the raw tag.
   *
   * Captured rather than discarded because the block carries the ONLY place a misconception's description is
   * stated in the learner's own terms — see the D5 measurement: 3 of 29 real events carried one, and those
   * carry `description` and `severity`. Dropping it would leave the notice with nothing to quote.
   */
  captured(): string[];
}

/**
 * Create a stripper for one turn.
 *
 * NOT shared between turns: a partial tag from turn A must never absorb text from turn B.
 */
export function createTelemetryStripper(): TelemetryStripper {
  let buffer = "";
  let inside = false;
  let body = "";
  const captured: string[] = [];

  const strip = (delta: string): string => {
    buffer += delta;
    let out = "";

    for (;;) {
      if (inside) {
        const end = buffer.indexOf(CLOSE);
        if (end === -1) {
          // Still inside a tag with no closer yet. Everything but a possible split closer is TAG CONTENT, so
          // it is captured (not emitted) — and a tail is held in case the closer arrives in halves.
          const keep = Math.min(buffer.length, CLOSE.length - 1);
          body += buffer.slice(0, buffer.length - keep);
          buffer = buffer.slice(buffer.length - keep);
          return out;
        }
        body += buffer.slice(0, end);
        captured.push(body);
        body = "";
        buffer = buffer.slice(end + CLOSE.length);
        inside = false;
        continue;
      }

      const start = buffer.indexOf(OPEN);
      if (start !== -1) {
        out += buffer.slice(0, start);
        buffer = buffer.slice(start + OPEN.length);
        inside = true;
        continue;
      }

      // No complete opening tag. Emit everything except a tail that might be the START of one.
      // Scan back from the end for a '<' that could begin the opening tag.
      let hold = 0;
      const limit = Math.min(buffer.length, MAX_HOLD);
      for (let n = limit; n > 0; n--) {
        const tail = buffer.slice(buffer.length - n);
        if (OPEN.startsWith(tail)) {
          hold = n;
          break;
        }
      }
      out += buffer.slice(0, buffer.length - hold);
      buffer = buffer.slice(buffer.length - hold);
      return out;
    }
  };

  const fn = ((delta: string) => strip(delta)) as TelemetryStripper;
  fn.flush = () => {
    const rest = buffer;
    buffer = "";
    // An unterminated tag at end of turn: its body is still telemetry, so capture it rather than show it.
    if (inside && rest) captured.push(body + rest);
    else if (rest) {
      // A held PARTIAL OPENING tag that never completed is ordinary text after all (e.g. "3 <"), so it is
      // released. Losing it would silently truncate a real reply.
      return rest;
    }
    body = "";
    inside = false;
    return "";
  };
  fn.captured = () => captured.slice();
  return fn;
}
