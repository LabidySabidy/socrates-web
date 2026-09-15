/**
 * turn.ts — accumulates a streamed tutor turn and reduces it to the tutor's PROSE.
 *
 * The tutor's reasoning is back-end working and is never rendered (owner, 2026-09-15: "the views are credit
 * reasoning doesn't provide any value to the user, nor do other back end messages"). It is still generated and
 * still written to the session file for debugging; this module simply does not keep it.
 *
 * `text_delta` is what accumulates. The inline-tag stripping below is computed over the WHOLE buffer rather
 * than per delta, because a tag can straddle two chunks: `"<thin"` then `"king>"`. Splitting delta-by-delta
 * would leak half a tag into the prose.
 */
export interface TurnState {
  /** Everything from text_delta, unsplit. */
  raw: string;
}

export function emptyTurn(): TurnState {
  return { raw: "" };
}

const OPEN = "<thinking>";
const CLOSE = "</thinking>";

/**
 * Fold one assistant message event into the turn. Unknown events are ignored, so a new event type
 * from the agent can never blank the console.
 */
export function reduceTurn(state: TurnState, event: unknown): TurnState {
  const e = event as { type?: string; delta?: unknown } | null;
  if (!e || typeof e.delta !== "string") return state;
  // `thinking_delta` is DELIBERATELY not accumulated. The tutor's reasoning is back-end working (owner,
  // 2026-09-15: "the views are credit reasoning doesn't provide any value to the user, nor do other back end
  // messages"). It is still generated and still persisted to the session file for debugging — it is simply
  // never rendered. Keeping a field here invites a render site to come back.
  if (e.type === "text_delta") return { ...state, raw: state.raw + e.delta };
  return state;
}

/**
 * Strip reasoning that arrived INLINE in the prose.
 *
 * The tutor sometimes emits `<thinking>…</thinking>` blocks or lines beginning `Thinking:` inside its visible
 * text. Those are internals and must not be rendered, so they are removed here rather than extracted for a
 * drawer — the point is that they never reach the screen at all.
 *
 * An unterminated block still counts as internals: it is mid-stream, and showing half of it would be worse
 * than showing none.
 */
export function splitInline(raw: string): { prose: string } {
  let prose = "";

  let rest = raw;
  for (;;) {
    const open = rest.indexOf(OPEN);
    if (open === -1) {
      prose += rest;
      break;
    }
    prose += rest.slice(0, open);
    const close = rest.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      break; // unterminated: everything from the tag onward is internals, so it is dropped
    }
    rest = rest.slice(close + CLOSE.length);
  }

  // Lines beginning `Thinking:` are internals too.
  const kept: string[] = [];
  for (const line of prose.split("\n")) {
    if (/^\s*Thinking:\s?/i.test(line)) continue;
    kept.push(line);
  }

  return { prose: kept.join("\n").replace(/^\n+/, "") };
}

/** The tutor's visible text for the turn. Reasoning is dropped, not returned. */
export function splitTurn(state: TurnState): { prose: string } {
  return splitInline(state.raw);
}

/** True while the turn has produced nothing visible yet — drives the "thinking…" presence state. */
export function isSilent(turn: TurnState): boolean {
  return splitTurn(turn).prose.trim().length === 0;
}

/**
 * The learner-facing text of an `[ERROR] …` frame from `/api/stream`.
 *
 * The server frames errors as `[ERROR] {"error":"…"}` so the shape matches the JSON deltas on the
 * same channel. Rendering that literal put `{"error":"pi process exited"}` in front of the learner,
 * so the wrapper is stripped here; anything that is not JSON is shown as it arrived, because a
 * crashed process can emit whatever it likes and swallowing it would hide the only clue.
 */
export function streamErrorText(frame: string): string {
  const payload = frame.replace(/^\[ERROR\]\s*/, "").trim();
  if (!payload) return "the turn failed with no message";
  try {
    const parsed = JSON.parse(payload) as { error?: unknown };
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    /* not JSON: show it as it arrived */
  }
  return payload;
}
