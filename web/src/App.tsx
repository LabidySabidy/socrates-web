/** App — route dispatch and the single course list both screens read from. */
import { useCallback, useEffect, useState } from "react";
import { fetchCourses } from "./api.ts";
import type { CoursesResponse } from "./types.ts";
import { useRoute } from "./router.ts";
import { TopBar } from "./components/TopBar.tsx";
import { HomePage } from "./components/HomePage.tsx";
import { CoursePage } from "./components/CoursePage.tsx";

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

  const visible = (data?.courses ?? []).filter((c) => !c.hidden);
  const unknownRoute = route.name === "unknown";

  return (
    <>
      <TopBar courseCount={data ? visible.length : null} />
      {route.name === "course" ? (
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
