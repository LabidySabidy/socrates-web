/**
 * Frame-batched stream folding.
 *
 * THE FREEZE THIS FIXES, measured: `LessonPage` called `setTurn()` on EVERY `message_update`, and
 * `Markdown.tsx:127` re-parsed the whole accumulated reply on every render. A turn with 6,442 deltas
 * therefore parsed **6.6M characters for a 2,037-character reply** — 3,222x the reply length, quadratic — and
 * Chrome showed "Page Unresponsive".
 *
 * Batching is the second half of the fix (memoising the parse is the first). It collapses a burst of deltas
 * into one update per animation frame, so the same turn costs ~2,200 updates instead of 6,442 while still
 * appearing to stream.
 *
 * ORDER AND COMPLETENESS ARE THE CONTRACT. Losing a delta would corrupt the reply, and reordering would scramble
 * it — both worse than the freeze. The tests below pin that the concatenation is identical to folding without
 * a batcher.
 */

export interface DeltaBatcher {
  /** Queue a delta. Does not render. */
  push(delta: string): void;
  /** The pending text, and clear it. Returns "" when nothing is pending. */
  drain(): string;
  /** Everything pushed but not yet drained. */
  pending(): string;
}

/**
 * Create a batcher.
 *
 * Deliberately has NO timer and no frame coupling: it accumulates, and the caller decides when to flush (one
 * flush per animation frame). Keeping the scheduling outside makes the ordering rules testable without a
 * browser, which is where the last stream bug hid.
 */
export function createDeltaBatcher(): DeltaBatcher {
  let queued = "";
  return {
    push(delta: string) {
      queued += delta;
    },
    drain() {
      const out = queued;
      queued = "";
      return out;
    },
    pending() {
      return queued;
    },
  };
}

/**
 * The interval between flushes, in ms.
 *
 * One animation frame at 60Hz is ~16ms. 50ms is deliberately slower than a frame: it cuts the update count by
 * roughly 3x more while still reading as live typing. Measured on the real failure, 6,442 deltas arrive over
 * 37 seconds — so a 50ms flush produces at most ~740 updates, and typically far fewer because deltas cluster.
 */
export const FLUSH_INTERVAL_MS = 50;
