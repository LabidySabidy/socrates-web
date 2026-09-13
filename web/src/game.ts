/**
 * game.ts — the launch-window game's logic, kept pure so the outcome rules are testable without a
 * canvas or a frame clock. The renderer only draws the state this produces.
 *
 * Mechanic (from the reference): a marker oscillates across a bar; pressing launch samples its
 * position; inside the target band is an insertion, outside it is a miss. After an outcome the arc
 * clears and the marker resumes, so each relaunch samples fresh timing.
 */

export interface TargetWindowSpec {
  kind: "target-window";
  /** Oscillations per second. */
  speed: number;
  /** Inclusive band the marker must be inside, in 0..100. */
  band: [number, number];
  caption?: string;
}

export type Phase = "idle" | "resolved";

export interface GameState {
  /** Seconds elapsed, used to derive the marker position. */
  t: number;
  /** Current marker position, 0..100. */
  marker: number;
  phase: Phase;
  outcome: "hit" | "miss" | null;
  message: string;
  shots: number;
  hits: number;
  /** Seconds since the outcome, so the arc can clear before the next shot. */
  sinceOutcome: number;
}

export const CLEAR_AFTER_SECONDS = 1.1;

export function initGame(): GameState {
  return { t: 0, marker: 50, phase: "idle", outcome: null, message: "", shots: 0, hits: 0, sinceOutcome: 0 };
}

/**
 * Triangle wave over 0..100 — simpler and more predictable to aim at than a sine, and it makes the
 * band a real timing window rather than something you can camp in.
 */
export function markerAt(t: number, speed: number): number {
  const period = 1 / Math.max(speed, 0.01);
  const phase = ((t % period) + period) % period;
  const half = period / 2;
  const p = phase <= half ? phase / half : (period - phase) / half;
  return p * 100;
}

export function tick(state: GameState, dt: number, spec: TargetWindowSpec): GameState {
  const t = state.t + Math.max(dt, 0);
  const next: GameState = { ...state, t, marker: markerAt(t, spec.speed) };
  if (state.phase === "resolved") {
    const sinceOutcome = state.sinceOutcome + dt;
    if (sinceOutcome >= CLEAR_AFTER_SECONDS) {
      return { ...next, phase: "idle", outcome: null, message: "", sinceOutcome: 0 };
    }
    return { ...next, sinceOutcome };
  }
  return next;
}

/** Launch at the current marker position. Ignored mid-flight, so a double press cannot cheat. */
export function launch(state: GameState, spec: TargetWindowSpec): GameState {
  if (state.phase === "resolved") return state;
  const [low, high] = spec.band;
  const hit = state.marker >= low && state.marker <= high;
  return {
    ...state,
    phase: "resolved",
    outcome: hit ? "hit" : "miss",
    message: hit
      ? "Insertion achieved — the satellite settles into orbit."
      : "Missed the window — the arc overshoots. Relaunch for fresh timing.",
    shots: state.shots + 1,
    hits: state.hits + (hit ? 1 : 0),
    sinceOutcome: 0,
  };
}

export function accuracy(state: GameState): number | null {
  if (state.shots === 0) return null;
  return state.hits / state.shots;
}

/** Where the marker sits within a band, as a 0..1 fraction — drives the target band's geometry. */
export function bandFraction(band: [number, number]): { start: number; width: number } {
  const [low, high] = band;
  return { start: Math.max(0, Math.min(100, low)) / 100, width: Math.max(0, Math.min(100, high) - Math.max(0, low)) / 100 };
}
