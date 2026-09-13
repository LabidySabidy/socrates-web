/**
 * HomePage — the catalogue, and nothing that lacks a backing field.
 *
 * Deliberately sparser than the design reference (confirmed in writing):
 *   - no streaks, levels, energy points, or achievement badges
 *   - no subject chips: a subject taxonomy cannot be derived from the learning markdown without
 *     inventing data, so it arrives only if `COURSE.md` can declare one
 *   - no "Continue where you left off" strip: recency lives in the session journal, which has no
 *     endpoint yet. Fabricating a percentage there is exactly what this project removed.
 *
 * Every number rendered here is summed from real per-course concept cards.
 */
import type { CourseRef, CoursesResponse } from "../types.ts";
import { MASTERY_STATES, mastery } from "../severity.ts";
import { MasteryRing } from "./MasteryRing.tsx";
import { hrefCourse } from "../router.ts";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}

const METRIC_STATES = ["Mastered", "Proficient", "Familiar"] as const;

function totals(courses: CourseRef[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(MASTERY_STATES.map((s) => [s, 0]));
  for (const c of courses) {
    for (const [state, n] of Object.entries(c.masteryCounts ?? {})) {
      out[state] = (out[state] ?? 0) + (n ?? 0);
    }
  }
  return out;
}

export function HomePage({
  data,
  visible,
  error,
}: {
  data: CoursesResponse | null;
  visible: CourseRef[];
  error: string | null;
}) {
  if (error) {
    return (
      <main className="page">
        <h1 className="display greeting">Cannot reach the server</h1>
        <p className="greeting-sub reading">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page">
        <p className="greeting-sub reading">Loading courses…</p>
      </main>
    );
  }

  const counts = totals(visible);
  const graded = METRIC_STATES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  return (
    <main className="page">
      <h1 className="display greeting">{greeting()}</h1>
      <p className="greeting-sub reading">
        {visible.length === 0
          ? "No courses discovered yet."
          : `${graded} of ${visible.reduce((n, c) => n + c.concepts, 0)} concepts are graded Familiar or better.`}
      </p>

      {visible.length > 0 ? (
        <div className="metrics" role="group" aria-label="Mastery across all courses">
          {METRIC_STATES.map((state) => (
            <span className="metric" key={state}>
              <span className="pip" style={{ border: `2px solid ${mastery(state).color}` }} aria-hidden="true" />
              <span className="n num">{counts[state] ?? 0}</span>
              <span className="eyebrow">{state}</span>
            </span>
          ))}
        </div>
      ) : null}

      {data.warnings.length > 0 ? (
        <p className="notice">
          Discovery warnings: {data.warnings.join(", ")}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="empty-note">
          <h2>Nothing here yet</h2>
          <p>
            No course was found under <code>{data.root ?? "(no scan root)"}</code>. A course is any
            directory containing <code>.agent/learning/</code>.
          </p>
        </div>
      ) : (
        <div className="grid">
          {visible.map((course) => (
            <a className="card" key={course.id} href={hrefCourse(course.id)}>
              <div className="card-head">
                <span className="eyebrow subject">{course.kind}</span>
                <MasteryRing
                  mastery={mastery(aggregateState(course))}
                  size={38}
                  stroke={3}
                  label={`${course.label}: ${aggregateState(course)}`}
                />
              </div>
              <h2 className="name">{course.label}</h2>
              <p className="desc">
                {course.concepts === 0
                  ? "No concept cards yet."
                  : `${course.concepts} concept${course.concepts === 1 ? "" : "s"}${
                      course.fromRegistry && !course.fromScan ? " · registered" : ""
                    }`}
              </p>
              <div className="footer">{course.concepts} unit{course.concepts === 1 ? "" : "s"}</div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

/** Course-level mastery is derived from the concept counts, not stored. */
function aggregateState(course: CourseRef): string {
  let best = "Not started";
  let bestCount = -1;
  for (const state of [...MASTERY_STATES].reverse()) {
    const n = course.masteryCounts?.[state] ?? 0;
    if (n > bestCount) {
      bestCount = n;
      best = state;
    }
  }
  return best;
}
