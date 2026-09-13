/** CoursePage — the two-pane browser: fixed unit rail, independently scrolling module pane. */
import { useEffect, useState } from "react";
import { fetchCourse, fetchLearning } from "../api.ts";
import type { CourseRef, CourseTree, LearningData, Unit } from "../types.ts";
import { MASTERY_STATES, mastery } from "../severity.ts";
import { hrefCourse, hrefHome } from "../router.ts";
import { MasteryLegend, MasteryRing } from "./MasteryRing.tsx";
import { ModuleIcon, moduleTypeLabel } from "./ModuleIcon.tsx";
import { TelemetryRail } from "./TelemetryRail.tsx";

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
    return (
      <main className="page">
        <h1 className="display greeting">Course unavailable</h1>
        <p className="greeting-sub reading">{error}</p>
        <a href={hrefHome()}>← All courses</a>
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
              <div className="unit-title">{u.title}</div>
            </span>
            <MasteryRing mastery={u.mastery} size={26} label={`${u.title}: ${u.mastery.state}`} />
          </a>
        ))}

        {tree.units.length === 0 ? (
          <p className="tray-empty" style={{ padding: "0 20px" }}>
            No concept cards in this course yet.
          </p>
        ) : null}

        <MasteryLegend states={LEGEND} />
      </nav>

      <main className="pane">
        <div className="pane-inner">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href={hrefHome()}>All courses</a>
            <span aria-hidden="true"> › </span>
            <span>{current?.label ?? courseId}</span>
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
                  Unit {selected.n}: {selected.title}
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
                  {group.modules.map((mod) => (
                    <div className="mod" key={mod.id}>
                      <ModuleIcon type={mod.type} />
                      <span className="mod-body">
                        <div className="mod-title">{mod.title}</div>
                        <div className="mod-type">
                          {moduleTypeLabel(mod.type)}
                          {mod.items ? ` · ${mod.items} items` : ""}
                        </div>
                        {mod.missing ? (
                          <div className="mod-missing">
                            references a concept card that does not exist: {mod.concept}
                          </div>
                        ) : null}
                      </span>
                      {mod.due === "due" ? <span className="due">due now</span> : null}
                      {mod.mastery ? (
                        <MasteryRing
                          mastery={mod.mastery}
                          size={10}
                          stroke={2}
                          label={`${mod.title}: ${mod.mastery.state}`}
                        />
                      ) : null}
                    </div>
                  ))}
                </section>
              ))}
            </>
          ) : (
            <div className="empty-note">
              <h2>No units yet</h2>
              <p>This course has no concept cards, so there is nothing to derive.</p>
            </div>
          )}

          <TelemetryRail learning={learning} />
        </div>
      </main>
    </div>
  );
}

export { MASTERY_STATES, mastery };
