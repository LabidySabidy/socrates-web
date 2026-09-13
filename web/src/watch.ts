/**
 * watch.ts — subscribe to change notifications.
 *
 * A separate channel from `/api/stream`: that one carries a chat turn and allows a single
 * subscriber, so a page that only wants filesystem changes must not occupy it. The server pushes
 * `{type:"reload", course}` whenever a course's SCHEMA.md or COURSE.md changes, and
 * `{type:"renamed", from, to}` when a course directory moves because its title changed. The hook hands
 * both to the caller: a page holding an old id follows the rename instead of 404ing.
 */
import { useEffect } from "react";

export type WatchFrame =
  | { kind: "reload"; course: string }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "other" };

/**
 * One frame from `/api/watch`, turned into something the caller can act on.
 *
 * Extracted from the hook so the frame shapes are testable without a DOM: the rename frame is the only
 * thing that tells a page its id is stale, so getting it wrong strands the page on a 404.
 */
export function parseWatchFrame(raw: string): WatchFrame {
  let payload: { type?: unknown; course?: unknown; from?: unknown; to?: unknown } | null = null;
  try {
    payload = JSON.parse(raw) as { type?: unknown; course?: unknown; from?: unknown; to?: unknown };
  } catch {
    return { kind: "other" }; // a heartbeat or an unknown frame
  }
  if (payload?.type === "reload" && typeof payload.course === "string") {
    return { kind: "reload", course: payload.course };
  }
  if (payload?.type === "renamed" && typeof payload.from === "string" && typeof payload.to === "string") {
    return { kind: "renamed", from: payload.from, to: payload.to };
  }
  return { kind: "other" };
}

export function useCourseWatch(
  onChange: (courseId: string) => void,
  enabled = true,
  onRenamed?: (from: string, to: string) => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    // EventSource reconnects on its own; no manual retry logic is warranted here.
    const source = new EventSource("/api/watch");
    source.onmessage = (event) => {
      const frame = parseWatchFrame(event.data);
      if (frame.kind === "reload") {
        onChange(frame.course);
        return;
      }
      // A rename moves the directory, so the id a page is holding becomes stale the moment the
      // filesystem follows the document. There is no alias table (deliberately), so the page follows
      // the frame rather than being redirected later.
      if (frame.kind === "renamed") onRenamed?.(frame.from, frame.to);
    };
    return () => source.close();
  }, [onChange, enabled]);
}
