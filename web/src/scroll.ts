/**
 * scroll.ts — remembers where a pane was scrolled.
 *
 * Exit Lesson must return to the originating unit "with position preserved", which the route
 * already guarantees (the unit number is in the URL) and this makes literal: coming back to the
 * course lands where you left it rather than at the top.
 */
const PREFIX = "socrates:scroll:";

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // private mode / disabled storage: the route alone still preserves the unit
  }
}

export function savePaneScroll(key: string, top: number): void {
  store()?.setItem(PREFIX + key, String(Math.round(top)));
}

export function readPaneScroll(key: string): number | null {
  const raw = store()?.getItem(PREFIX + key);
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function courseScrollKey(courseId: string, unit: number | null): string {
  return `${courseId}:${unit ?? 1}`;
}
