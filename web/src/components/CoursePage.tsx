/** CoursePage — the two-pane browser: fixed unit rail, independently scrolling module pane. */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCourse, fetchLearning } from "../api.ts";
import type { CourseRef, CourseTree, LearningData, Unit } from "../types.ts";
import { MASTERY_STATES, mastery } from "../severity.ts";
import { hrefCourse, hrefHome, hrefLab, hrefLesson, hrefQuiz } from "../router.ts";
import { courseScrollKey, readPaneScroll, savePaneScroll } from "../scroll.ts";
import { useCourseWatch } from "../watch.ts";
import { EditableTitle } from "./EditableTitle.tsx";
import { grillHref, moduleAskHref, scaffoldHref } from "../grill.ts";
import { humanize } from "../humanize.ts";
import { courseErrorView } from "../course-error.ts";
import { MasteryLegend, MasteryRing } from "./MasteryRing.tsx";
import { ModuleIcon, moduleTypeLabel } from "./ModuleIcon.tsx";
import { moduleRingLabel } from "../module-types.ts";
import { TelemetryRail } from "./TelemetryRail.tsx";
import { JournalPanel } from "./JournalPanel.tsx";

/** Module types that run as a live tutor session. */
// D10 — `review` was MISSING from this set, so the row rendered as an inert DIV while `grill.ts:98` already had
// a working prompt for it. Report #10 (`2026-09-15T05-00-46-178Z-d8d0851d`): "I also dont like that Review is
// not clickable. if it is locked then we should show a locked icon and perhaps a tooltip". The owner's read was
// reasonable — it looks deliberate — but it was an omission, and measured side by side: Recite was an `<a>`
// with an href and a pointer cursor, Review was a `<div>` with neither.
//
// `moduleAskHref` handles `recite`, `explain` AND `review`; the set is what decides whether the row opens.
const TUTOR_MODULE_TYPES = new Set(["recite", "explain", "review", "ai-activity"]);

/** Module types that open the quiz console. */
const QUIZ_MODULE_TYPES = new Set(["quiz", "test", "course-challenge"]);

/** Module types that open the interactive / game lab. */
const LAB_MODULE_TYPES = new Set(["interact", "game"]);

const LEGEND = [
  { label: "Not started", color: "#c9c6bd" },
  { label: "Attempted", color: "#d97706" },
  { label: "Familiar", color: "#4a6fa5" },
  { label: "Proficient", color: "#2d7a4c" },
  { label: "Mastered", color: "#14462c" },
];

export function CoursePage({
  courseId,
  unitNumber,
  courses,
}: {
  courseId: string;
  unitNumber: number | null;
  courses: CourseRef[];
}) {
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [learning, setLearning] = useState<LearningData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);

  // Exit Lesson saves the pane's scroll position; restore it when we come back to the same unit.
  useEffect(() => {
    if (!tree) return;
    const saved = readPaneScroll(courseScrollKey(courseId, unitNumber ?? 1));
    if (saved === null) return;
    const id = requestAnimationFrame(() => {
      if (paneRef.current) paneRef.current.scrollTop = saved;
    });
    return () => cancelAnimationFrame(id);
  }, [tree, courseId, unitNumber]);

  const reload = useCallback(() => {
    Promise.all([fetchCourse(courseId), fetchLearning(courseId)])
      .then(([t, l]) => {
        setTree(t);
        setLearning(l);
      })
      .catch(() => {
        /* a failed refresh keeps the last good view */
      });
  }, [courseId]);

  // The tutor writes SCHEMA.md mid-session; pick that up without a page reload.
  useCourseWatch(
    useCallback(
      (changed: string) => {
        if (changed === courseId) reload();
      },
      [courseId, reload],
    ),
    true,
    // The directory moved, so this page's id is stale. There is no alias table to redirect through
    // (deliberately), so the page follows the frame and stays on the unit it was showing.
    useCallback(
      (from: string, to: string) => {
        if (from !== courseId) return;
        window.location.hash = hrefCourse(to, unitNumber ?? undefined).slice(1);
      },
      [courseId, unitNumber],
    ),
  );

  useEffect(() => {
    let alive = true;
    setTree(null);
    setLearning(null);
    setError(null);
    Promise.all([fetchCourse(courseId), fetchLearning(courseId)])
      .then(([t, l]) => {
        if (!alive) return;
        setTree(t);
        setLearning(l);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  if (error) {
    // The same mapping the lesson uses: a raw `unknown course: <slug>` is the API's phrasing, not a
    // message, and a rename is the usual reason an id goes stale while the app is open.
    const view = courseErrorView(error);
    return (
      <main className="page">
        <h1 className="display greeting">{view.heading}</h1>
        <p className="greeting-sub reading">{view.detail}</p>
        {view.renamed ? (
          <p className="reading">
            Your courses are listable from the library, where the current name is.
          </p>
        ) : null}
        <p>
          <a className="primary" href={hrefHome()}>
            ← Back to the library
          </a>
        </p>
      </main>
    );
  }
  if (!tree) {
    return (
      <main className="page">
        <p className="greeting-sub reading">Loading course…</p>
      </main>
    );
  }

  const selected: Unit | null = tree.units.find((u) => u.n === unitNumber) ?? tree.units[0] ?? null;

  /**
   * Where a grill click should go: the unit whose title IS the concept (the derived model is one unit
   * per concept card), falling back to the unit on screen. Ported from the original click handler,
   * which posted `/skill:grill-misconception <concept>` directly.
   */
  const grillTo = (concept: string) => {
    const unit = tree.units.find((u) => u.title.toLowerCase() === concept.toLowerCase());
    // The href builder owns the prompt: a caller passes the concept, never a hand-built command.
    return grillHref(courseId, unit?.n ?? selected?.n ?? 1, concept);
  };
  const current = courses.find((c) => c.id === courseId);

  return (
    <div className="course">
      <nav className="rail" aria-label="Units">
        <div className="eyebrow rail-label">Course</div>
        <select
          className="course-switch"
          aria-label="Switch course"
          value={courseId}
          onChange={(e) => {
            window.location.hash = hrefCourse(e.target.value).slice(1);
          }}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        {tree.units.map((u) => (
          <a
            key={u.n}
            className="unit"
            href={hrefCourse(courseId, u.n)}
            aria-current={selected?.n === u.n ? "true" : undefined}
          >
            <span className="unit-body">
              <span className="unit-n">Unit {u.n}</span>
              <div className="unit-title">{humanize(u.title)}</div>
            </span>
            <MasteryRing mastery={u.mastery} size={26} label={`${humanize(u.title)}: ${u.mastery.state}`} />
          </a>
        ))}

        {tree.units.length === 0 ? (
          <p className="tray-empty rail-empty">
            No concept cards yet, so there are no units to show.{" "}
            <a href={scaffoldHref(courseId)}>Scaffold this course</a>.
          </p>
        ) : null}

        <MasteryLegend states={LEGEND} />
      </nav>

      <main className="pane" ref={paneRef}>
        <div className="pane-inner">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href={hrefHome()}>All courses</a>
            <span aria-hidden="true"> › </span>
            <EditableTitle
              courseId={courseId}
              // B3 — the TREE wins over the course list. The tree is the payload that reconciles a blocked
              // rename (it derives its title from the directory and warns), while the list derives a title
              // from the H1 alone. Preferring the list put a name in the breadcrumb that this URL could not
              // reach: the page said "Taken" while the route said `locked`.
              title={tree.title || current?.label || courseId}
              as="span"
              onRenamed={(_from, to) => {
                window.location.hash = hrefCourse(to, unitNumber ?? undefined).slice(1);
              }}
            />
            {selected ? (
              <>
                <span aria-hidden="true"> › </span>
                <span aria-current="page">Unit {selected.n}</span>
              </>
            ) : null}
          </nav>

          {tree.warnings.length > 0 ? (
            <p className="notice" role="status">
              {tree.warnings.join(" · ")}
            </p>
          ) : null}

          {selected ? (
            <>
              <div className="pane-head">
                <h1 className="display">
                  Unit {selected.n}: {humanize(selected.title)}
                </h1>
                <MasteryRing
                  mastery={selected.mastery}
                  size={60}
                  stroke={3}
                  label={`Unit ${selected.n} mastery: ${selected.mastery.state}`}
                />
              </div>

              {selected.blurb ? <p className="blurb reading">{selected.blurb}</p> : null}

              {selected.groups.map((group) => (
                <section className="group" key={group.title}>
                  <h2>{group.title}</h2>
                  {group.modules.map((mod) => {
                    // Tutor-backed activities open the chat console; other types keep their
                    // screens deferred (P5/P6), so their rows stay static.
                    const opensLesson = TUTOR_MODULE_TYPES.has(mod.type);
                    const opensQuiz = QUIZ_MODULE_TYPES.has(mod.type);
                    const opensLab = LAB_MODULE_TYPES.has(mod.type);
                    const Row = opensLesson ? "a" : "div";
                    return (
                    <Row
                      className="mod"
                      key={mod.id}
                      {...(opensLab && selected
                        ? { href: hrefLab(courseId, selected.n) }
                        : opensQuiz && selected
                        ? { href: hrefQuiz(courseId, selected.n) }
                        : opensLesson && selected
                        ? {
                            // Carry the INTENT, not just the destination: a Recite or Explain row used
                            // to open the lesson with nothing dispatched, so the tutor sat silent until
                            // the learner typed. The grill row already did this.
                            href:
                              moduleAskHref(courseId, selected.n, mod.type, mod.concept ?? "") ??
                              hrefLesson(courseId, selected.n),
                            // Save on the way OUT of the course page: by the time the lesson
                            // renders, this pane is gone and its scroll offset is unrecoverable.
                            onClick: () =>
                              savePaneScroll(
                                courseScrollKey(courseId, selected.n),
                                paneRef.current?.scrollTop ?? 0,
                              ),
                          }
                        : {})}
                    >
                      <ModuleIcon type={mod.type} />
                      <span className="mod-body">
                        <div className="mod-title">{mod.title}</div>
                        <div className="mod-type">
                          {moduleTypeLabel(mod.type)}
                          {mod.items ? ` · ${mod.items} items` : ""}
                        </div>
                        {mod.missing ? (
                          <div className="mod-missing">
                            references a concept card that does not exist: {humanize(mod.concept ?? "")}
                          </div>
                        ) : null}
                      </span>
                      {mod.due === "due" ? <span className="due">due now</span> : null}
                      {mod.mastery ? (
                        <MasteryRing
                          mastery={mod.mastery}
                          size={10}
                          stroke={2}
                          // The visible title dropped its verb, so the accessible name has to carry the
                          // type instead — see moduleRingLabel.
                          label={moduleRingLabel(mod.type, mod.title, mod.mastery.state)}
                        />
                      ) : null}
                    </Row>
                    );
                  })}
                </section>
              ))}
            </>
          ) : (
            <div className="empty-note">
              <h2>This course is not scaffolded yet</h2>
              <p>
                It has a mission but no <code>SCHEMA.md</code> concept cards, and units are derived
                from concept cards — so there is nothing to derive yet. That is a normal state for a
                course you just started, not a broken one.
              </p>
              <p>
                The tutor can interview you and write the concept cards and the plan. It runs inside
                this course's directory, so it can read the mission.
              </p>
              <a className="primary scaffold-action" href={scaffoldHref(courseId)}>
                Scaffold this course with the tutor
              </a>
            </div>
          )}

          <TelemetryRail learning={learning} grillHref={grillTo} />
          <JournalPanel courseId={courseId} />
        </div>
      </main>
    </div>
  );
}

export { MASTERY_STATES, mastery };
