/**
 * transcript.ts — the lesson transcript.
 *
 * The original appended the learner's message the moment it was sent
 * (`append("user", message)`, 06cee66^:public/app.js:181) and kept it there, so the conversation read
 * as a conversation. The React console rendered only the current tutor turn, which meant a sent
 * message left no visible trace — the fifth behaviour dropped in the cutover.
 *
 * Kept pure so the settle rule is testable: an empty reply must not add a blank block, and a reply
 * truncated at a gate token settles as what was actually shown.
 */
import { splitAtGate } from "./restgate.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export function appendUser(history: ChatTurn[], text: string): ChatTurn[] {
  const message = text.trim();
  if (!message) return history;
  return [...history, { role: "user", text: message }];
}

/**
 * Settle a finished tutor turn into the transcript.
 *
 * Everything from a gate token onward is a control signal, so what settles is the prose the learner
 * actually saw. A turn that produced nothing visible adds nothing.
 */
export function settleAssistant(history: ChatTurn[], rawProse: string): ChatTurn[] {
  const text = splitAtGate(rawProse).prose.trim();
  if (!text) return history;
  return [...history, { role: "assistant", text }];
}

export function isTranscriptEmpty(history: ChatTurn[]): boolean {
  return history.length === 0;
}
