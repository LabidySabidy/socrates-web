/** api.ts — the only place the client talks to the server. */
import type { CourseRef, CourseTree, CoursesResponse, Journal, LearningData } from "./types.ts";
import type { AssessmentsResponse } from "./assessment-types.ts";
import type { InteractivesResponse } from "./interactives-types.ts";

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

/** Quiz items for a unit: authored when the course declares them, else previously generated. */
export const fetchAssessments = (id: string, unit: number) =>
  get<AssessmentsResponse>(`/api/courses/${encodeURIComponent(id)}/assessments?unit=${unit}`);

/**
 * Ask the tutor to generate items. A failure returns the parsed error body rather than throwing,
 * so the caller can render the reason instead of an empty quiz.
 */
export async function generateAssessments(
  id: string,
  unit: number,
  count = 3,
): Promise<AssessmentsResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit, count }),
  });
  const body = (await res.json().catch(() => ({}))) as AssessmentsResponse;
  if (!res.ok) {
    return {
      unit,
      source: "none",
      items: [],
      warnings: [],
      error: body.error ?? `HTTP ${res.status}`,
      detail: body.detail,
      excerpt: body.excerpt,
    };
  }
  return body;
}

export interface ResultResponse {
  recorded?: boolean;
  unit?: number;
  right?: number;
  wrong?: number;
  total?: number;
  /** Always null: socrates-web does not run the extension's projection, so the FILE has not moved. */
  mastery?: string | null;
  /** A badge the attempt earned and logged, awaiting the tutor's projection. */
  pendingBadge?: { concept: string; badge: string; state: string } | null;
  error?: string;
}

/** Record a completed attempt. History only — the response carries no mastery claim. */
export async function recordResult(
  id: string,
  body: { unit: number; source: string; right: number; wrong: number; total: number; itemIds: string[] },
): Promise<ResultResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as ResultResponse;
  if (!res.ok) return { recorded: false, error: parsed.error ?? `HTTP ${res.status}` };
  return parsed;
}

export const fetchInteractives = (id: string, unit: number) =>
  get<InteractivesResponse>(`/api/courses/${encodeURIComponent(id)}/interactives?unit=${unit}`);

/** Ask the tutor to design an interactive. A failure returns the reason, never a partial result. */
export async function generateInteractives(id: string, unit: number): Promise<InteractivesResponse> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}/interactives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit }),
  });
  const body = (await res.json().catch(() => ({}))) as InteractivesResponse;
  if (!res.ok) {
    return {
      unit,
      source: "none",
      interactives: [],
      warnings: [],
      error: body.error ?? `HTTP ${res.status}`,
      detail: body.detail,
      excerpt: body.excerpt,
    };
  }
  return body;
}




export interface CreateCourseResult {
  ok?: boolean;
  id?: string;
  dir?: string;
  error?: string;
  courses?: CourseRef[];
}

/** Start a course from a SUBJECT. Nothing on disk is pointed at; the store owns the directory. */
export async function createCourseFromSubject(subject: string): Promise<CreateCourseResult> {
  const res = await fetch("/api/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject }),
  });
  const body = (await res.json().catch(() => ({}))) as CreateCourseResult;
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return body;
}

export type RenameResult =
  | { ok: true; id: string; title: string; renamed: boolean; deferred?: boolean }
  | { ok: false; error: string };

/**
 * Rename a course.
 *
 * The title is the H1 of MISSION.md — the one place a name lives — and the server derives the rest:
 * it writes the H1, then reconciles, which moves the directory when the slug changed. A rename asked
 * for while the tutor is mid-turn is accepted as `deferred`: the agent's cwd IS the course directory
 * and Windows cannot rename it out from under a live process, so the move lands on settle and the
 * page is told through the watch channel.
 */
export async function renameCourse(id: string, title: string): Promise<RenameResult> {
  const res = await fetch(`/api/courses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* a non-JSON body is still a failure */
  }
  if (!res.ok && res.status !== 202) {
    return { ok: false, error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
  }
  return {
    ok: true,
    id: typeof body.id === "string" ? body.id : id,
    title: typeof body.title === "string" ? body.title : title,
    renamed: body.renamed === true,
    deferred: body.deferred === true,
  };
}
