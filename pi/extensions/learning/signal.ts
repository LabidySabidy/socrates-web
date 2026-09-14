/**
 * signal.ts — pure detection of "this turn was a grill turn".
 *
 * Used by the `telemetry_missing` check: if a grill turn produced no telemetry,
 * that absence is recorded instead of silently ignored (DEF-001).
 */
export const GRILL_SKILLS = ["grill-misconception", "feynman-recite"] as const;

interface MaybeEntry {
  type?: string;
  message?: { role?: string; content?: unknown };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string } | null;
        return block?.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("\n");
  }
  return "";
}

/** The most recent user message's text, or null if there is none. */
export function lastUserMessageText(entries: unknown[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as MaybeEntry | null;
    if (e?.message?.role === "user") return contentText(e.message.content);
  }
  return null;
}

/**
 * Count USER PROMPTS (exchanges), not agent turns.
 *
 * One prompt can span several agent turns — every tool-call round is its own turn —
 * so counting `turn_end` reported 4 for a single exchange. Nothing consumes the
 * agent-turn count, so it is not kept at all.
 */
export function countUserPrompts(entries: unknown[]): number {
  let n = 0;
  for (const raw of entries) {
    const e = raw as MaybeEntry | null;
    if (e?.message?.role === "user") n++;
  }
  return n;
}

/**
 * True when the latest user message was a skill expansion for a grill skill —
 * i.e. a grill was requested for the turn just answered.
 *
 * This says a grill was ASKED FOR. It does NOT say the turn owed telemetry: a grill that is still
 * probing has reached no verdict, so there is no state change to record and its silence is correct.
 * Use `detectRecordableGrillTurn` for the gap check.
 */
export function detectGrillTurn(entries: unknown[]): { active: boolean; evidence?: string } {
  const text = lastUserMessageText(entries);
  if (!text) return { active: false };
  for (const skill of GRILL_SKILLS) {
    if (text.includes(`<skill name="${skill}"`)) return { active: true, evidence: skill };
  }
  return { active: false };
}


/**
 * Did the tutor reach a VERDICT on this turn — the point at which telemetry is owed?
 *
 * T-057: `detectGrillTurn` alone fired the gap check on every grill turn, so a grill that was still
 * probing logged `telemetry_missing` — observed nine times on one unit — while the skill correctly asks
 * for a block only when a concept's proficiency changes or a misconception is opened or resolved. The
 * signal therefore could not tell "the pipeline is broken" from "nothing changed yet", which is exactly
 * the distinction the record is supposed to carry: Step 3 makes the tutor read these records, and a false
 * gap misinforms the recap.
 *
 * A verdict is present when the tutor NAMED a state: a badge or the word `record_learning`. Both are
 * things a probing turn does not do — it asks questions. The check is deliberately generous in the other
 * direction: if a verdict is named and no telemetry arrived, the gap is real and still recorded.
 */
export function tutorReachedVerdict(assistantText: string | null): boolean {
  if (!assistantText) return false;
  // A bare badge, or the tool the extension exposes for recording one.
  return /⬜|🟥|🟨|🟩|🟦/.test(assistantText) || text(assistantText, "record_learning");
}

/**
 * True when this turn was a grill AND the tutor reached a verdict, so a missing block is a real gap.
 *
 * Returns the same `{active, evidence}` shape so the caller's behaviour is unchanged when it fires — only
 * WHEN it fires is narrowed.
 */
export function detectRecordableGrillTurn(
  entries: unknown[],
  assistantText: string | null,
): { active: boolean; evidence?: string } {
  const grill = detectGrillTurn(entries);
  if (!grill.active) return { active: false };
  if (!tutorReachedVerdict(assistantText)) return { active: false };
  return grill;
}

/** The most recent ASSISTANT message's text, or null if there is none. */
export function lastAssistantMessageText(entries: unknown[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as MaybeEntry | null;
    if (e?.message?.role === "assistant") return contentText(e.message.content);
  }
  return null;
}

function text(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}
