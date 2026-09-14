/**
 * ManageCourses — the course catalogue's control panel.
 *
 * There is one thing to do here now: name a subject and start a course. The directory field, the
 * folder browser, the registry list and the "not initiated" list are gone with the discovery stack —
 * a course is a subject, and the store owns where it lives.
 */
import { useState } from "react";
import { createCourseFromSubject } from "../api.ts";
import { scaffoldHref } from "../grill.ts";
import { humanMessage } from "../course-error.ts";
import type { CourseRef } from "../types.ts";

export function ManageCourses({
  courses,
  onChanged,
}: {
  courses: CourseRef[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    const clean = subject.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    void createCourseFromSubject(clean).then((res) => {
      setBusy(false);
      if (!res.ok || !res.id) {
        setError(res.error ?? "could not start the course");
        return;
      }
      setSubject("");
      onChanged();
      // Straight into the interview, with the prompt visible in the composer.
      window.location.hash = scaffoldHref(res.id).slice(1);
    });
  }

  return (
    <section className="manage" aria-label="Start a course">
      <div className="manage-head">
        <h2 className="eyebrow">Courses</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Done" : "Start a course"}
        </button>
      </div>

      <p className="manage-root eyebrow">Courses live in your Socrates library, not in a project folder.</p>

      {open ? (
        <div className="manage-body">
          <form
            className="subject-form"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <label>
              <span className="eyebrow">What is the subject?</span>
              <span className="dir-row">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Supabase row-level security"
                  aria-label="Course subject"
                  autoFocus
                />
                <button type="submit" className="primary" disabled={busy || !subject.trim()}>
                  {busy ? "Starting…" : "Start course"}
                </button>
              </span>
            </label>
            <p className="manage-hint">
              Your words become the title. Socrates then interviews you — what you will be able to do,
              what you will build, what you already know — and writes the mission from your answers.
            </p>
          </form>

          {error ? (
            <p className="notice" role="status">
              {humanMessage(error)}
            </p>
          ) : null}

          {courses.length > 0 ? (
            <ul className="manage-list">
              {courses.map((c) => (
                <li key={c.id}>
                  <span className="manage-name">{c.label}</span>
                  <span className="manage-src eyebrow">
                    {c.concepts === 0
                      ? "not scaffolded yet"
                      : `${c.concepts} concept${c.concepts === 1 ? "" : "s"}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
