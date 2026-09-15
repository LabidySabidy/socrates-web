/**
 * Apply the telemetry stripper to a pi stream line.
 *
 * WHY THIS IS NOT PART OF `stream-clean.ts`. That module strips a *text stream* and knows nothing about pi's
 * wire format. The line is JSON, so the delta has to be reached, cleaned (with cross-delta state), written
 * back, and the whole thing re-serialised without disturbing any other field. Keeping the two apart means the
 * stripper can be tested per-character without a JSON envelope, and this can be tested against pi's real event
 * shapes without re-implementing the buffering.
 *
 * NON-TEXT LINES PASS THROUGH UNTOUCHED. `auto_retry_start`, `agent_settled` and failure records carry no delta
 * and must survive byte-for-byte — the failure-surfacing work depends on them.
 */
import type { TelemetryStripper } from "./stream-clean.ts";

/** A pi line whose `assistantMessageEvent.delta` is the text the learner sees. */
interface DeltaLine {
  assistantMessageEvent?: { type?: unknown; delta?: unknown };
}

/**
 * Strip telemetry from the text delta in `line`, returning a line safe to send to the client.
 *
 * Returns the ORIGINAL string when there is nothing to clean, so ordinary events are not re-serialised (which
 * would risk changing key order or number formatting on lines other code depends on).
 */
export function stripTelemetryFromLine(line: string, stripper: TelemetryStripper): string {
  // Cheap rejection first: only a message_update can carry a delta, and the vast majority of lines are neither.
  if (!line.includes("text_delta")) return line;

  let parsed: DeltaLine;
  try {
    parsed = JSON.parse(line) as DeltaLine;
  } catch {
    return line; // not JSON — not ours to rewrite
  }
  const ev = parsed.assistantMessageEvent;
  if (!ev || ev.type !== "text_delta" || typeof ev.delta !== "string") return line;

  const cleaned = stripper(ev.delta);
  // An empty result means the delta was ENTIRELY telemetry. Sending a text_delta with "" would append nothing
  // and is harmless, but skipping it keeps the stream honest about there being no visible content.
  if (cleaned === ev.delta) return line;
  return JSON.stringify({ ...parsed, assistantMessageEvent: { ...ev, delta: cleaned } });
}
