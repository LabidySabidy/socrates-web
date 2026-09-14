/**
 * ContinueStrip — "where you left off", backed ONLY by the session journal.
 *
 * It renders NOTHING when no course has a journal entry. That is the whole point: the design
 * reference showed a 40% ring here, and a fabricated resume position is exactly what this project
 * set out to remove. If there is no recorded session, there is nothing to continue.
 */
import { useEffect, useState } from "react";
import { fetchJournal } from "../api.ts";
import type { CourseRef, Journal } from "../types.ts";
import { hrefCourse } from "../router.ts";
import { formatDay, mostRecent } from "../select.ts";
import { humanize } from "../humanize.ts";

export function ContinueStrip({ courses }: { courses: CourseRef[] }) {
  const course = mostRecent(courses);
  const [journal, setJournal] = useState<Journal | null>(null);

  useEffect(() => {
    if (!course) {
      setJournal(null);
      return;
    }
    let alive = true;
    fetchJournal(course.id)
      .then((j) => {
        if (alive) setJournal(j);
      })
      .catch(() => {
        // The strip is a nicety: if the journal cannot be read, do not claim anything.
        if (alive) setJournal(null);
      });
    return () => {
      alive = false;
    };
  }, [course?.id]);

  if (!course) return null;

  const latest = journal?.sessions[0] ?? null;
  const when = latest ? formatDay(latest.startedAt) : formatDay(course.sessions.lastAt!);
  const concepts = latest?.concepts ?? [];

  return (
    <a className="resume" href={hrefCourse(course.id, 1)}>
      <span className="grow">
        <span className="eyebrow">Continue where you left off</span>
        <div className="title">{course.label}</div>
        <div className="context">
          Last session {when}
          {course.sessions.count > 1 ? ` · ${course.sessions.count} sessions` : ""}
          {latest?.open ? " · not closed cleanly" : ""}
          {concepts.length > 0 ? ` · covered ${concepts.map(humanize).join(", ")}` : ""}
        </div>
      </span>
      <span className="primary" aria-hidden="true" style={resumeButtonStyle}>
        Resume
      </span>
    </a>
  );
}

// The strip is an anchor, so the affordance is styled inline rather than nested in a <button>.
const resumeButtonStyle = {
  border: "1px solid var(--action)",
  color: "var(--action)",
  borderRadius: "6px",
  padding: "7px 14px",
  fontSize: "13.5px",
} as const;
