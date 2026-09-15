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
  /**
   * The tutor's reasoning for this turn, when the record has it (D6).
   *
   * Restored alongside the prose so the Socratic Reasoning drawer has something to show after a reload. Absent
   * means the record genuinely had none — never an empty string, so "no reasoning recorded" stays honest.
   */
  thinking?: string;
  /**
   * Who authored a LEARNER-side turn.
   *
   * The tutor now opens a lesson (Step 2a) by sending an instruction on the learner's behalf, and that
   * instruction was rendered in the same bubble a typed message uses — so the learner read
   * `/skill:grill-misconception … I have not worked on it before`, a slash command and scripted
   * first-person text they never wrote. `origin` distinguishes the app's own dispatch from the learner's
   * own words; absent means the learner typed it.
   */
  origin?: "opening" | "dispatch";
}

export function appendUser(history: ChatTurn[], text: string, origin?: ChatTurn["origin"]): ChatTurn[] {
  const message = text.trim();
  if (!message) return history;
  return [...history, origin ? { role: "user", text: message, origin } : { role: "user", text: message }];
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
