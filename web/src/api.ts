/** api.ts — the only place the client talks to the server. */
import type { CourseRef, CourseTree, CoursesResponse, Journal, LearningData } from "./types.ts";

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

/** Session history for a course. Content comes from the SESSIONS projection, not the raw log. */
export const fetchJournal = (id: string) =>
  get<Journal>(`/api/courses/${encodeURIComponent(id)}/journal`);

/** One session's markdown, as the writer produced it. */
export async function fetchSessionMarkdown(id: string, file: string): Promise<string> {
  const res = await fetch(
    `/api/courses/${encodeURIComponent(id)}/journal/${encodeURIComponent(file)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
