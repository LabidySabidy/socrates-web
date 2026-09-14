/**
 * history.ts — restore a settled transcript.
 *
 * The client kept the conversation in React state only, so a refresh dropped everything the learner and
 * the tutor had said while the data sat untouched in two places. This reads it back.
 *
 * WHY PI'S SESSION FILE, NOT THE STREAM REPLAY. `/api/stream` does replay a finished turn — measured at
 * 3,626 lines ending `[DONE]` — but it replays FRAMES: 1,794 `message_update` events, of which 195 are
 * text deltas, interleaved with tool calls and thinking. Reconstructing prose from that means replaying
 * a streaming protocol and hoping the delta set is complete, and it gives no way to tell a turn that
 * finished from one that was cut off. pi's session file is the durable record: one `message` entry per
 * message, `role` explicit, the assistant's final text already assembled. Restoring from it is a read.
 *
 * SETTLED TURNS ONLY. A turn that was mid-stream when the page closed is not restored as if complete —
 * an entry with no tool results after its last `toolCall`, or a final assistant message that never
 * arrived, is DROPPED rather than shown. Dropped, not marked, because a half-turn rendered as a finished
 * reply is indistinguishable from a real one to the learner, and a "this is incomplete" badge on a
 * sentence that reads perfectly well is noise. The tutor re-opens the unit on the next load anyway
 * (Step 2a), so nothing is lost by leaving it out — it is simply asked again.
 */

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/** The slice of a pi session entry this module reads. Everything else is ignored. */
interface PiEntry {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

/** The assistant's visible prose: every `text` part, in order. Thinking and tool calls are not prose. */
function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim();
}

function userText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null)
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim();
}

/**
 * A skill dispatch is machinery, not conversation.
 *
 * `/skill:scaffold-learning` seeded as the learner's turn is already shown in the console (T-050), but a
 * restored transcript should not open with a `<skill name="…">` block — that is the app talking to the
 * tutor. The human-readable part of the original message is kept when there is one.
 */
function isSkillDispatch(text: string): boolean {
  return text.trimStart().startsWith("<skill name=");
}

/**
 * Rebuild the settled transcript from pi's session JSONL.
 *
 * Pure: takes the file's text and returns turns, so the rules are testable without a session.
 *
 * A `user` entry opens a turn; the LAST assistant entry before the next user entry is the reply that
 * settles it. Intermediate assistant entries carry only tool calls, so taking the last non-empty one is
 * what makes a tool-heavy turn restore as the sentence the learner actually read.
 */
export function parseHistory(jsonl: string): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  let pending: string | null = null;
  let lastAssistant = "";

  const flush = () => {
    if (pending === null) return;
    const text = lastAssistant.trim();
    // SETTLED ONLY: a user turn with no assistant prose after it is a turn that never finished — the
    // message was sent and the reply was cut off, or the last thing pi wrote was a tool call whose result
    // never came. Dropped rather than shown as a finished exchange, because a half-turn rendered like a
    // real reply is indistinguishable from one to the learner. The tutor re-opens the unit on the next
    // load, so nothing is lost by leaving it out.
    if (text) {
      turns.push({ role: "user", text: pending });
      turns.push({ role: "assistant", text });
    }
    pending = null;
    lastAssistant = "";
  };

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(trimmed) as PiEntry;
    } catch {
      continue; // a partial final line is normal when a session was killed mid-write
    }
    if (entry.type !== "message" || !entry.message) continue;
    const role = entry.message.role;

    if (role === "user") {
      flush();
      const text = userText(entry.message.content);
      if (text && !isSkillDispatch(text)) pending = text;
      else pending = null;
      continue;
    }
    if (role === "assistant") {
      const text = assistantText(entry.message.content);
      if (text) lastAssistant = text;
      continue;
    }
    // toolResult entries carry no prose; the assistant entry after them does.
  }
  flush();
  return turns;
}

/**
 * Read the tail of a session file, for a transcript that may be large.
 *
 * A long course produces a multi-megabyte JSONL. The console shows the recent conversation, so the tail
 * is enough and keeps the endpoint from loading a whole session into memory to render one screen.
 */
export function tailLines(text: string, limit: number): string {
  const lines = text.split("\n");
  return lines.length <= limit ? text : lines.slice(-limit).join("\n");
}
