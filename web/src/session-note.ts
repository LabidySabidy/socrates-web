/**
 * session-note.ts — presenting a session record.
 *
 * Two things a raw record must not do: leak the machine it was written on, and state a past belief as if
 * it were still true.
 */
import type { ContinuityResponse } from "./api.ts";

type SessionView = ContinuityResponse["sessions"][number];

/**
 * Strip absolute paths from anything shown.
 *
 * A session record stores `Transcript: C:\Users\<username>\...` because that is a real filesystem path the
 * app needs. Once it is DISPLAYED it is only noise that leaks the OS username (GL-019), so the
 * underlying event data is left untouched and the view says something useful instead.
 *
 * Rewrites rather than blanks, because "where did this session run" is a legitimate question and "in this
 * course" answers it.
 */
export function stripAbsolutePaths(text: string): string {
  return (
    text
      // Windows drive-absolute, POSIX absolute, and UNC — the three ways a path starts.
      .replace(/[A-Za-z]:\\[^\s`"')]*/g, "(this course)")
      .replace(/\/(?:home|Users|var|tmp)\/[^\s`"')]*/g, "(this course)")
      .replace(/\\\\[^\s`"')]+/g, "(this course)")
  );
}

/**
 * One line of "what happened in that session", reconciled against what is true now.
 *
 * THE POINT OF THIS FUNCTION: a misconception row is a statement about a moment. If the learner's wrong
 * belief was recorded live in an early session and put right three sittings later, opening the early
 * session must not read as though they still hold it. The row is shown with its own tense, then annotated
 * with the current one — never silently rewritten, so the history stays honest.
 */
export function sessionMisconceptionLine(
  row: SessionView["misconceptions"][number],
): { text: string; sinceResolved: boolean } {
  const base = row.occurred === "resolved" ? "Corrected" : "Open";
  const now =
    row.sinceResolved
      ? " — since resolved"
      : row.occurred === "open" && row.currentState === "open"
        ? " — still open"
        : "";
  return { text: `${base}: ${stripAbsolutePaths(row.summary)}${now}`, sinceResolved: row.sinceResolved };
}

/** How many of a session's misconceptions have been put right since. */
export function resolvedSinceCount(session: SessionView): number {
  return session.misconceptions.filter((m) => m.sinceResolved).length;
}
