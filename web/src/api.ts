/** api.ts — the only place the client talks to the server. */
import type { CourseRef, CourseTree, CoursesResponse, LearningData } from "./types.ts";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const fetchCourses = () => get<CoursesResponse>("/api/courses");
export const fetchCourse = (id: string) => get<CourseTree>(`/api/courses/${encodeURIComponent(id)}`);
export const fetchLearning = (id: string) =>
  get<LearningData>(`/api/courses/${encodeURIComponent(id)}/learning`);

export interface RegisterResult {
  ok: boolean;
  error?: string;
  stillDiscovered?: boolean;
  hint?: string;
  courses?: CourseRef[];
}

export async function postCourse(body: {
  dir: string;
  action?: "register" | "unregister" | "hide" | "unhide";
  label?: string;
  order?: number;
}): Promise<RegisterResult> {
  const res = await fetch("/api/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as RegisterResult;
}
