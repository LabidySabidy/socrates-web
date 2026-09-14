/** App — route dispatch and the single course list both screens read from. */
import { useCallback, useEffect, useState } from "react";
import { fetchCourses } from "./api.ts";
import type { CoursesResponse } from "./types.ts";
import { hrefCourse, useNavigation } from "./router.ts";
import { catalogueCourses } from "./select.ts";
import { TopBar } from "./components/TopBar.tsx";
import { HomePage } from "./components/HomePage.tsx";
import { CoursePage } from "./components/CoursePage.tsx";
import { LessonPage } from "./components/LessonPage.tsx";
import { QuizPage } from "./components/QuizPage.tsx";
import { LabPage } from "./components/LabPage.tsx";

export function App() {
  const { route, sequence } = useNavigation();
  const [data, setData] = useState<CoursesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Global, as the original header checkbox was; the server applies it to the prompt. */
  const [budapest, setBudapest] = useState(false);

  const load = useCallback(() => {
    fetchCourses()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  // Only initiated courses reach the catalogue and its count; the rest stay in manage.
  const visible = catalogueCourses(data?.courses ?? []);
  const unknownRoute = route.name === "unknown";

  return (
    <>
      {/* F2 — first in the DOM so it is the first thing Tab reaches, and out of flow until focused. The
          chrome (brand, Budapest toggle, breadcrumb, Exit) is 4 Tab stops before any content, on every
          route; a keyboard user needs a way past it. Targets #main-content, which each route now carries —
          the lesson wraps its content in `div.lesson`, not `<main>`, so a landmark-only target would have
          moved focus nowhere on the page a learner actually sits on. */}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          // `href="#main-content"` alone SCROLLS but does not reliably move focus: measured in the browser,
          // activation left `document.activeElement` on <body>, so the next Tab returned to the chrome the
          // learner had just skipped — a skip link that skips nothing. The focus move is explicit.
          const target = document.getElementById("main-content");
          if (!target) return;
          e.preventDefault();
          target.focus();
          target.scrollIntoView({ block: "start" });
          window.history.replaceState(null, "", "#main-content");
        }}
      >
        Skip to content
      </a>
      <TopBar courseCount={data ? visible.length : null} budapest={budapest} onBudapestChange={setBudapest} />
      {route.name === "lab" ? (
        <LabPage
          courseId={route.courseId}
          unitNumber={route.unit}
          onExit={() => {
            window.location.hash = hrefCourse(route.courseId, route.unit).slice(1);
          }}
        />
      ) : route.name === "quiz" ? (
        <QuizPage
          courseId={route.courseId}
          unitNumber={route.unit}
          onExit={() => {
            window.location.hash = hrefCourse(route.courseId, route.unit).slice(1);
          }}
        />
      ) : route.name === "lesson" ? (
        <LessonPage
          courseId={route.courseId}
          unitNumber={route.unit}
          ask={route.ask}
          arrival={sequence}
          budapest={budapest}
          onExit={() => {
            // Back to the originating unit: the route carries it, so position survives the trip.
            window.location.hash = hrefCourse(route.courseId, route.unit).slice(1);
          }}
        />
      ) : route.name === "course" ? (
        <CoursePage courseId={route.courseId} unitNumber={route.unit} courses={visible} />
      ) : (
        <HomePage
          data={data}
          visible={visible}
          error={unknownRoute ? `Unknown route: #/${route.raw}` : error}
          onChanged={load}
        />
      )}
    </>
  );
}
