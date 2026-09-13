/**
 * misconceptions.ts — the tray projection.
 *
 * A learner must NEVER be shown duplicates. The registry can legitimately hold several rows for
 * one id (the backend warns about it as a data-integrity signal — see `duplicate-registry-row`),
 * but rendering collapses them to ONE row per id. No counts, no repeated beliefs.
 *
 * When rows for an id disagree, the most complete wins: a resolution beats an open row, then a
 * filled corrected model, then the newest date. Nothing is dropped silently — the collapsed row
 * records how many registry rows it represents for diagnostics.
 */
import type { Misconception, SeverityState } from "./types.ts";
import { SEVERITY_ORDER } from "./severity.ts";

export interface TrayRow {
  id: string;
  concept: string;
  /** The most complete description for this id. */
  misconception: string;
  corrected: string;
  status: "open" | "resolved";
  severity: SeverityState;
  date: string;
  /** Registry rows collapsed into this one. 1 in a clean registry. */
  rowCount: number;
}

function better(a: Misconception, b: Misconception): Misconception {
  if (a.status !== b.status) return a.status === "resolved" ? a : b;
  if (Boolean(a.corrected) !== Boolean(b.corrected)) return a.corrected ? a : b;
  if (a.misconception.length !== b.misconception.length) {
    return a.misconception.length > b.misconception.length ? a : b;
  }
  return a.date >= b.date ? a : b;
}

export function trayRows(misconceptions: Misconception[]): TrayRow[] {
  const byId = new Map<string, { best: Misconception; count: number }>();
  for (const m of misconceptions) {
    const existing = byId.get(m.id);
    if (!existing) {
      byId.set(m.id, { best: m, count: 1 });
      continue;
    }
    byId.set(m.id, { best: better(existing.best, m), count: existing.count + 1 });
  }

  return [...byId.values()]
    .map(({ best, count }) => ({
      id: best.id,
      concept: best.concept,
      misconception: best.misconception,
      corrected: best.corrected,
      status: best.status,
      // `severityState` is derived server-side; a collapsed row keeps the most severe live rating
      // only if the winning row is still open, otherwise it is resolved.
      severity: (best.status === "resolved" ? "resolved" : best.severityState) as SeverityState,
      date: best.date,
      rowCount: count,
    }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.id.localeCompare(b.id),
    );
}

/** Active rows minus resolved — what the tray header is allowed to claim. */
export function activeCount(rows: TrayRow[]): number {
  return rows.filter((r) => r.status !== "resolved").length;
}
