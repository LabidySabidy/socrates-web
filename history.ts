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
  /**
   * The tutor's reasoning for this turn, when the record has it.
   *
   * D6 (report #6, `2026-09-15T05-07-15-660Z-539bec85`): the owner clicked into a lesson, then out, then back,
   * and the Socratic Reasoning drawer said nothing was recorded. Live turns showed reasoning and restored ones
   * did not, because this reader kept only `text` parts. Absent means the record genuinely had none — never
   * an empty string, so the drawer can tell "no reasoning" from "reasoning that was empty".
   */
  thinking?: string;
  /**
   * Set when the APP opened this turn (a skill dispatch), so the UI shows it as the tutor's opening rather
   * than as the learner's own words (D13/D14, and the C2 defect it must not reintroduce).
   */
  origin?: "app";
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

/** The assistant's reasoning: every `thinking` part, in order. Separate from prose by design. */
function assistantThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: string; thinking?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "thinking" && typeof part.thinking === "string")
    .map((part) => part.thinking as string)
    .join(String.fromCharCode(10))
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
  // The reasoning that accompanies `lastAssistant`. Tracked beside the prose, not inside it, so the drawer can
  // show the tutor's working without it appearing in the conversation.
  let lastThinking = "";
  /** The pending turn was opened by the APP (a skill dispatch), not typed by the learner (D13/D14). */
  let appOpened = false;

  const flush = () => {
    if (pending === null) return;
    const text = lastAssistant.trim();
    // SETTLED ONLY: a user turn with no assistant prose after it is a turn that never finished — the
    // message was sent and the reply was cut off, or the last thing pi wrote was a tool call whose result
    // never came. Dropped rather than shown as a finished exchange, because a half-turn rendered like a
    // real reply is indistinguishable from one to the learner. The tutor re-opens the unit on the next
    // load, so nothing is lost by leaving it out.
    if (text) {
      // The learner's own words, or a marker that the app opened this turn. A dispatch is NEVER rendered as
      // speech — it carries a slash command and scripted first-person text they did not write (C2) — but the
      // turn itself is real, and dropping it lost the tutor's opening explanation.
      turns.push(appOpened ? { role: "user", text: "", origin: "app" } : { role: "user", text: pending });
      // `thinking` is OMITTED when the record had none, rather than set to "", so the drawer can distinguish
      // "no reasoning recorded" from "reasoning that was empty".
      turns.push({ role: "assistant", text, ...(lastThinking.trim() ? { thinking: lastThinking.trim() } : {}) });
    }
    pending = null;
    lastAssistant = "";
    lastThinking = "";
    appOpened = false;
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
      if (text && !isSkillDispatch(text)) {
        pending = text;
      } else if (text && isSkillDispatch(text)) {
        // D13/D14 — A TURN THE APP OPENED STILL COUNTS.
        //
        // The first user message in a tutor-opened lesson IS the skill dispatch. Setting `pending = null` for
        // it dropped the tutor's entire opening explanation, because `flush` needs a pending user turn to
        // settle the reply into. Measured on the real course: the session's only user message is
        // `<skill name="grill-misconception" …>` followed by a real reply, and this returned ZERO turns —
        // reports #13 (`…d7dfdcd2`) "doesnt include the lessons before the question" and #14 (`…e9c8d721`)
        // "doesnt guaruntee the previous explainer teachings are re-displayed".
        //
        // The dispatch's own TEXT is still never shown (the C2 defect must not return); it is marked as
        // app-authored so the UI renders it as the tutor's opening rather than as the learner's words.
        pending = text;
        appOpened = true;
      } else {
        pending = null;
        appOpened = false;
      }
      continue;
    }
    if (role === "assistant") {
      const text = assistantText(entry.message.content);
      if (text) {
        lastAssistant = text;
        // Paired with the prose it belongs to: an assistant entry that produced text is the one whose
        // reasoning the learner was watching.
        lastThinking = assistantThinking(entry.message.content);
      }
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
