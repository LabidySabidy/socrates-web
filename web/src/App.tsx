/** App — route dispatch and the single course list both screens read from. */
import { useCallback, useEffect, useState } from "react";
import { fetchCourses } from "./api.ts";
import type { CoursesResponse } from "./types.ts";
import { hrefCourse, useRoute } from "./router.ts";
import { catalogueCourses } from "./select.ts";
import { TopBar } from "./components/TopBar.tsx";
import { HomePage } from "./components/HomePage.tsx";
import { CoursePage } from "./components/CoursePage.tsx";
import { LessonPage } from "./components/LessonPage.tsx";
import { QuizPage } from "./components/QuizPage.tsx";
import { LabPage } from "./components/LabPage.tsx";

export function App() {
  const route = useRoute();
  const [data, setData] = useState<CoursesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <TopBar courseCount={data ? visible.length : null} />
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
