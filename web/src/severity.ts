/**
 * severity.ts / mastery.ts — the two display scales.
 *
 * MIRRORED from `learning-parser.ts` (the server-side source of truth). The client cannot import
 * it because it uses `node:fs`. If a colour or label changes, change it there first — and the
 * severity *state* is derived server-side (`severityState`) rather than recomputed here, so only
 * presentation lives in this file.
 */
import type { Mastery, MasteryState, SeverityState } from "./types.ts";

export const MASTERY_STATES: MasteryState[] = [
  "Not started",
  "Attempted",
  "Familiar",
  "Proficient",
  "Mastered",
];

const MASTERY: Record<MasteryState, Mastery> = {
  "Not started": { state: "Not started", color: "#c9c6bd", ring: 0 },
  Attempted: { state: "Attempted", color: "#d97706", ring: 0.25 },
  Familiar: { state: "Familiar", color: "#4a6fa5", ring: 0.5 },
  Proficient: { state: "Proficient", color: "#2d7a4c", ring: 0.78 },
  Mastered: { state: "Mastered", color: "#14462c", ring: 1 },
};

/** Anything outside the union reads Not started. A sixth state is never correct. */
export function mastery(state: string | undefined): Mastery {
  return MASTERY[(state ?? "") as MasteryState] ?? MASTERY["Not started"];
}

export const SEVERITY_LABEL: Record<SeverityState, string> = {
  root: "Root",
  partial: "Partial",
  edge: "Edge",
  resolved: "Resolved",
  unrated: "Unrated",
};

export const SEVERITY_COLOR: Record<SeverityState, string> = {
  root: "#c83f3f",
  partial: "#d97706",
  edge: "#d4a72c",
  resolved: "#c9c6bd",
  unrated: "rgba(32,31,29,0.55)",
};

/** Sort order for the tray: live problems first, by how fundamental, resolved last. */
export const SEVERITY_ORDER: Record<SeverityState, number> = {
  root: 0,
  partial: 1,
  edge: 2,
  unrated: 3,
  resolved: 4,
};
