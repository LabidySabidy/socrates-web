/**
 * HomePage — the catalogue, and nothing that lacks a backing field.
 *
 * Deliberately sparser than the design reference (confirmed in writing):
 *   - no streaks, levels, energy points, or achievement badges
 *   - no subject chips: a subject taxonomy cannot be derived from the learning markdown without
 *     inventing data
 *   - the continue strip is backed ONLY by the session journal, and renders nothing without one
 *
 * Every number rendered here is summed from real per-course concept cards.
 */
import { useMemo, useState } from "react";
import type { CourseRef, CoursesResponse } from "../types.ts";
import { MASTERY_STATES, mastery } from "../severity.ts";
import { MasteryRing } from "./MasteryRing.tsx";
import { ContinueStrip } from "./ContinueStrip.tsx";
import { ManageCourses } from "./ManageCourses.tsx";
import { hrefCourse } from "../router.ts";
import { humanMessage } from "../course-error.ts";
import { humanize } from "../humanize.ts";
import { filterCourses, totalMasteryCounts } from "../select.ts";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}

const METRIC_STATES = ["Mastered", "Proficient", "Familiar"] as const;

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

export function HomePage({
  data,
  visible,
  error,
  onChanged,
}: {
  data: CoursesResponse | null;
  visible: CourseRef[];
  error: string | null;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCourses(visible, query), [visible, query]);

  if (error) {
    return (
      <main className="page">
        <h1 className="display greeting">Cannot reach the server</h1>
        <p className="greeting-sub reading">{humanMessage(error)}</p>
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

  const counts = totalMasteryCounts(visible, MASTERY_STATES);
  const graded = METRIC_STATES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  return (
    <main className="page" id="main-content" tabIndex={-1}>
      <h1 className="display greeting">{greeting()}</h1>
      <p className="greeting-sub reading">
        {visible.length === 0
          ? "Your library is empty."
          : `${graded} of ${visible.reduce((n, c) => n + c.concepts, 0)} concepts are graded Familiar or better.`}
      </p>

      <ContinueStrip courses={visible} />

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
        <p className="notice">Warnings: {data.warnings.join(", ")}</p>
      ) : null}

      <ManageCourses courses={data.courses} onChanged={onChanged} />

      {visible.length === 0 ? (
        <div className="empty-note">
          <h2>Start with a subject</h2>
          {/*
           * The empty state is the first thing a new learner reads, so it names the next action
           * rather than describing where a course might be found. The old copy asserted the removed
           * model — "a course is any directory containing .agent/learning/" — which is exactly the
           * frame P16 deleted, and it left the learner with nothing to do.
           */}
          <p>
            A course begins with a subject you name — not a folder you point at. Use{" "}
            <strong>Start a course</strong> above: type what you want to learn in your own words, and
            Socrates interviews you about what you will be able to do, what you will build, and what
            you already know. Your answers become the mission.
          </p>
          <p className="eyebrow">
            Courses live in <code>{data.root ?? "~/.socrates/courses"}</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="search-row">
            <input
              className="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search courses"
              aria-label="Search courses"
            />
            <span className="eyebrow">
              {filtered.length} of {visible.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-note">
              <h2>Nothing matches that yet</h2>
              <p>No course label or mission contains “{query.trim()}”.</p>
              <button type="button" className="primary" onClick={() => setQuery("")}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid">
              {filtered.map((course) => (
                // Not an <a> around everything any more: the title is now editable, and an input
                // inside a link is both invalid markup and impossible to click. The link keeps opening
                // the course; the title is the rename affordance.
                <div className="card" key={course.id}>
                  <div className="card-head">
                    <MasteryRing
                      mastery={mastery(aggregateState(course))}
                      size={38}
                      stroke={3}
                      label={`${course.label}: ${aggregateState(course)}`}
                    />
                  </div>
                  {/* D11 — the catalogue shows the name, it does not offer to rename it.
                      Report #11 (`2026-09-15T04-59-21-950Z-2230e300`): "i dont like that on the home page if I
                      click the name it tries to rename it, renaming should only be available once you're in the
                      course". Browsing a list and editing a name are different intentions, and a destructive
                      control sitting under a click meant for navigation is a trap. Renaming lives in the course
                      header now. */}
                  <h2 className="name">{humanize(course.label)}</h2>
                  <a className="card-open" href={hrefCourse(course.id)}>
                    <p className="desc">
                      {course.concepts === 0
                        ? "Started, but not scaffolded yet — the tutor writes the concept cards with you."
                        : `${course.concepts} concept${course.concepts === 1 ? "" : "s"}`}
                    </p>
                    <div className="footer">
                      {course.concepts === 0
                        ? "Not scaffolded yet"
                        : `${course.concepts} unit${course.concepts === 1 ? "" : "s"}`}
                      {course.sessions.count > 0
                        ? ` · ${course.sessions.count} session${course.sessions.count === 1 ? "" : "s"}`
                        : ""}
                    </div>
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
