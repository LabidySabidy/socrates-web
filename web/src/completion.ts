/**
 * completion.ts — what the quiz completion screen is ALLOWED to say.
 *
 * This exists because the screen used to assert "Skill moved to Proficient" while nothing in the
 * system computed or wrote a mastery change. That is the same class of unfounded claim as the
 * 40% resume ring, the badge discs, and the subject chips — copy asserting state that no field
 * backs.
 *
 * The rule, enforced here and tested: a line renders only when the response carries the field it
 * describes. `masteryLine` is null unless the server sends a mastery string.
 */

export interface CompletionView {
  heading: string;
  scoreLine: string;
  /** Present once the attempt has been persisted; absent when recording failed. */
  recordedLine: string | null;
  /** NULL unless the response actually carries a mastery value. Never inferred. */
  masteryLine: string | null;
}

export interface CompletionInput {
  right: number;
  wrong: number;
  total: number;
  /** True when the server confirmed it appended the attempt. */
  recorded: boolean;
  /** A mastery value from the response, if any. `null`/absent means there is nothing to claim. */
  mastery?: string | null;
  /** The recording call itself failed. */
  recordError?: string | null;
}

export function completionView(input: CompletionInput): CompletionView {
  const scoreLine =
    `${input.right} of ${input.total} correct` +
    (input.wrong > 0 ? ` · ${input.wrong} answered wrong` : " · no mistakes");

  let recordedLine: string | null;
  if (input.recordError) recordedLine = `Not recorded: ${input.recordError}`;
  else if (input.recorded) recordedLine = "This attempt was recorded in the course history.";
  else recordedLine = null;

  // The only path to a mastery claim is a mastery value on the response.
  const mastery =
    typeof input.mastery === "string" && input.mastery.trim().length > 0
      ? input.mastery.trim()
      : null;

  return {
    heading: "Nice work.",
    scoreLine,
    recordedLine,
    masteryLine: mastery === null ? null : `Skill moved to ${mastery}`,
  };
}
