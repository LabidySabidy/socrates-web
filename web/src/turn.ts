/**
 * turn.ts — accumulates a streamed tutor turn and splits it into
 * thinking (the Socratic Reasoning drawer) and visible prose.
 *
 * The split is computed over the WHOLE accumulated buffer rather than per delta, because a tag can
 * straddle two chunks: `"<thin"` then `"king>"`. Splitting delta-by-delta would leak half a tag
 * into the prose.
 */
export interface TurnState {
  /** thinking_delta content, which is already separate on the wire. */
  thinking: string;
  /** Everything from text_delta, unsplit. */
  raw: string;
}

export function emptyTurn(): TurnState {
  return { thinking: "", raw: "" };
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
  if (e.type === "thinking_delta") return { ...state, thinking: state.thinking + e.delta };
  if (e.type === "text_delta") return { ...state, raw: state.raw + e.delta };
  return state;
}

/**
 * Extract reasoning that arrived inline in the prose.
 *
 * Two shapes are handled: `<thinking>…</thinking>` blocks (an unterminated block counts as
 * thinking — it is still streaming), and lines beginning `Thinking:`.
 */
export function splitInline(raw: string): { thinking: string; prose: string } {
  const reasoning: string[] = [];
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
      reasoning.push(rest.slice(open + OPEN.length));
      break;
    }
    reasoning.push(rest.slice(open + OPEN.length, close));
    rest = rest.slice(close + CLOSE.length);
  }

  const kept: string[] = [];
  for (const line of prose.split("\n")) {
    const m = /^\s*Thinking:\s?(.*)$/i.exec(line);
    if (m) reasoning.push(m[1]);
    else kept.push(line);
  }

  return { thinking: reasoning.join("\n").trim(), prose: kept.join("\n").replace(/^\n+/, "") };
}

/** The drawer and the prose, with wire thinking and inline thinking combined. */
export function splitTurn(state: TurnState): { thinking: string; prose: string } {
  const inline = splitInline(state.raw);
  const thinking = [state.thinking.trim(), inline.thinking].filter(Boolean).join("\n\n");
  return { thinking, prose: inline.prose };
}

/** True while the turn has produced nothing visible yet — drives the "thinking…" presence state. */
export function isSilent(turn: TurnState): boolean {
  const { thinking, prose } = splitTurn(turn);
  return thinking.length === 0 && prose.trim().length === 0;
}
