/**
 * router.ts — hash routing.
 *
 * Hashes (not history paths) on purpose: the design references are hash-routed, and a hash needs
 * no SPA catch-all on the Node server, so dev and prod route identically.
 *
 *   #/home
 *   #/course/:courseId
 *   #/course/:courseId/:unitNumber
 */
import { useEffect, useState } from "react";
import { splitHash } from "./grill.ts";

export type Route =
  | { name: "home" }
  | { name: "course"; courseId: string; unit: number | null }
  | { name: "lesson"; courseId: string; unit: number; ask: string | null }
  | { name: "quiz"; courseId: string; unit: number }
  | { name: "lab"; courseId: string; unit: number }
  | { name: "unknown"; raw: string };

export function parseHash(hash: string): Route {
  // The query is split off first: it can carry a prompt to dispatch, and leaving it attached would
  // feed `1?ask=…` to the unit parser.
  const { path, params } = splitHash(hash);
  const parts = path.split("/").filter(Boolean);
  const ask = params.get("ask");
  if (parts.length === 0 || parts[0] === "home") return { name: "home" };
  if (parts[0] === "lesson" && parts[1]) {
    const unit = Number(parts[2]);
    return {
      name: "lesson",
      courseId: decodeURIComponent(parts[1]),
      unit: Number.isFinite(unit) && unit > 0 ? unit : 1,
      ask: ask && ask.trim() ? ask : null,
    };
  }
  if (parts[0] === "lab" && parts[1]) {
    const unit = Number(parts[2]);
    return { name: "lab", courseId: decodeURIComponent(parts[1]), unit: Number.isFinite(unit) && unit > 0 ? unit : 1 };
  }
  if (parts[0] === "quiz" && parts[1]) {
    const unit = Number(parts[2]);
    return {
      name: "quiz",
      courseId: decodeURIComponent(parts[1]),
      unit: Number.isFinite(unit) && unit > 0 ? unit : 1,
    };
  }
  if (parts[0] === "course" && parts[1]) {
    const unit = parts[2] ? Number(parts[2]) : null;
    return {
      name: "course",
      courseId: decodeURIComponent(parts[1]),
      unit: unit !== null && Number.isFinite(unit) && unit > 0 ? unit : null,
    };
  }
  return { name: "unknown", raw: hash };
}

export function hrefHome(): string {
  return "#/home";
}
export function hrefCourse(courseId: string, unit?: number): string {
  return unit ? `#/course/${encodeURIComponent(courseId)}/${unit}` : `#/course/${encodeURIComponent(courseId)}`;
}

export function hrefLab(courseId: string, unit: number): string {
  return `#/lab/${encodeURIComponent(courseId)}/${unit}`;
}

export function hrefQuiz(courseId: string, unit: number): string {
  return `#/quiz/${encodeURIComponent(courseId)}/${unit}`;
}

export function hrefLesson(courseId: string, unit: number): string {
  return `#/lesson/${encodeURIComponent(courseId)}/${unit}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    // normalise an empty hash so the URL is always shareable
    if (!window.location.hash) window.location.replace(hrefHome());
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
