/**
 * select.ts — pure list logic kept out of the components so it can be tested without a browser.
 */
import type { CourseRef } from "./types.ts";

/**
 * Search across the label and the mission destination.
 * There is no subject taxonomy to filter by: deriving one from the learning markdown would be
 * invented data, so search is the only filter.
 */
export function filterCourses(courses: CourseRef[], query: string): CourseRef[] {
  const q = query.trim().toLowerCase();
  if (!q) return courses;
  return courses.filter(
    (c) => c.label.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
  );
}

/**
 * The visible course with the most recent recorded session, or null.
 *
 * Recency comes from the SESSIONS file names, which the server parses. A course with no recorded
 * session is never a candidate — that is what keeps the continue strip honest.
 */
export function mostRecent(courses: CourseRef[]): CourseRef | null {
  const withSessions = courses.filter((c) => c.sessions.count > 0 && c.sessions.lastAt);
  if (withSessions.length === 0) return null;
  return withSessions.reduce((best, c) =>
    (c.sessions.lastAt ?? "") > (best.sessions.lastAt ?? "") ? c : best,
  );
}

/** The five-state mastery counts, summed across courses. Used by the catalogue metric row. */
export function totalMasteryCounts(
  courses: CourseRef[],
  states: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(states.map((s) => [s, 0]));
  for (const c of courses) {
    for (const [state, n] of Object.entries(c.masteryCounts ?? {})) {
      out[state] = (out[state] ?? 0) + (n ?? 0);
    }
  }
  return out;
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
