/**
 * watch.ts — subscribe to change notifications.
 *
 * A separate channel from `/api/stream`: that one carries a chat turn and allows a single
 * subscriber, so a page that only wants filesystem changes must not occupy it. The server pushes
 * `{type:"reload", course}` whenever a course's SCHEMA.md or COURSE.md changes, and the hook hands
 * the changed course id to the caller.
 */
import { useEffect } from "react";

export function useCourseWatch(onChange: (courseId: string) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    // EventSource reconnects on its own; no manual retry logic is warranted here.
    const source = new EventSource("/api/watch");
    source.onmessage = (event) => {
      let payload: { type?: string; course?: unknown } | null = null;
      try {
        payload = JSON.parse(event.data) as { type?: string; course?: unknown };
      } catch {
        return; // a heartbeat or an unknown frame
      }
      if (payload?.type === "reload" && typeof payload.course === "string") {
        onChange(payload.course);
      }
    };
    return () => source.close();
  }, [onChange, enabled]);
}
