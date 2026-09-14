/**
 * continuity.ts — what is TRUE NOW versus what HAPPENED THEN.
 *
 * A course accumulates one session record per sitting, and nothing ever read them back. The learner's
 * own telemetry showed six sittings on one unit with six `session_start` events and near-zero progress,
 * because each sitting started from nothing.
 *
 * THE DISTINCTION THIS MODULE EXISTS FOR. A session record is a snapshot of a moment; a concept card is
 * the current truth. A misconception opened in session 1 and resolved in session 4 must read as
 * SINCE-RESOLVED when you open session 1 — otherwise the record contradicts the thing it is a record of.
 * So a session's facts are always reported against the card's present state, never as its own opinion.
 */
import type { LearningData, Misconception } from "./learning-parser.ts";
import type { SessionSummary } from "./journal.ts";

/** One session, with its claims reconciled against the concept cards' current state. */
export interface SessionView {
  file: string;
  startedAt: string | null;
  endedAt: string | null;
  open: boolean;
  turns: number | null;
  /** Concept ids the session touched, in the order the record lists them. */
  concepts: string[];
  /**
   * Misconception rows as the record wrote them, each annotated with where it stands NOW.
   *
   * The row's own status is the past tense; `currentState` is the registry's present tense. When they
   * disagree in the direction that matters — the row says `open`, the registry says `resolved` — this
   * session is one where the learner's wrong belief was still live, and reading it must say so.
   */
  misconceptions: {
    id: string;
    concept: string;
    summary: string;
    /** The status the RECORD claimed at the time. */
    occurred: "open" | "resolved";
    /** Where that misconception stands in the course right now. */
    currentState: Misconception["status"] | "unknown";
    /** True when this session recorded it open and the registry now has it resolved. */
    sinceResolved: boolean;
  }[];
}

/** What a concept needs before the tutor can open on it. */
export interface ConceptStanding {
  concept: string;
  /** The card's badge label, e.g. "Not started" / "Familiar". */
  mastery: string;
  /** True when the learner has never worked on it — no reviews, no badge beyond unmeasured. */
  isNew: boolean;
  /** Concept ids with telemetry or a non-initial badge. */
  touched: boolean;
  openMisconceptions: string[];
  resolvedMisconceptions: string[];
}

/** A course's continuity: the current standing of every concept, and the history reconciled against it. */
export interface Continuity {
  concepts: ConceptStanding[];
  sessions: SessionView[];
  /** Concept ids appearing in any session record. */
  workedOn: string[];
}

/** The card's status field, however it was written (`status:` or a badge heading). */
function misconceptionStatus(raw: Misconception | undefined): Misconception["status"] | "unknown" {
  return raw ? raw.status : "unknown";
}

/**
 * Build the continuity view.
 *
 * `learning` is the present tense (cards, badges, misconception registry); `sessions` is the past. Every
 * past claim is resolved against `learning`, which is what lets an old record say "since resolved".
 */
export function buildContinuity(
  learning: LearningData | null,
  sessions: SessionSummary[],
  /** The misconception registry as it stands now, keyed by id. */
  registry: Map<string, Misconception>,
): Continuity {
  const concepts: ConceptStanding[] = (learning?.schema.concepts ?? []).map((card) => {
    const reviews = card.sm2?.repetitions ?? 0;
    const interval = card.sm2?.interval ?? 0;
    // The registry is keyed by id and each entry names its concept, which is the only link between the
    // two: a card does not carry a back-reference.
    const mine = [...registry.values()].filter((m) => m.concept === card.name);
    return {
      concept: card.name,
      mastery: card.label,
      isNew: card.badge === "⬜" && reviews === 0 && interval === 0,
      touched: reviews > 0 || interval > 0 || card.badge !== "⬜",
      openMisconceptions: mine.filter((m) => m.status === "open").map((m) => m.id),
      resolvedMisconceptions: mine.filter((m) => m.status === "resolved").map((m) => m.id),
    };
  });


  const sessionsOut: SessionView[] = sessions.map((s) => ({
    file: s.file,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    open: s.open,
    turns: s.turns,
    concepts: s.concepts,
    misconceptions: s.misconceptionRows.map((m) => {
      const now = misconceptionStatus(registry.get(m.id));
      // The case this module exists for: the record says the belief was live, and the registry says it
      // has since been put right.
      const sinceResolved = m.claimed === "open" && now === "resolved";
      return {
        id: m.id,
        concept: m.concept,
        summary: m.summary,
        occurred: m.claimed,
        currentState: now,
        sinceResolved,
      };
    }),
  }));

  const workedOn = [...new Set(sessions.flatMap((s) => s.concepts))];
  return { concepts, sessions: sessionsOut, workedOn };
}

/**
 * How the tutor should open a unit — the deterministic routing Step 4d asks for.
 *
 * Kept here rather than in the client so the server, the recap and any test agree on one rule.
 */
export type LessonMode = "teach" | "recap-then-probe" | "grill";

export function lessonMode(input: {
  /** An explicit dispatch from a module row or the tray. */
  asked: boolean;
  /** The concept's standing in the course right now. */
  standing: ConceptStanding | null;
  /** True when the unit has any prior session record. */
  hasHistory: boolean;
}): LessonMode {
  // An explicit ask always wins: the learner clicked something and named the mode with it.
  if (input.asked) return "grill";
  const s = input.standing;
  // New concept → teach. Nothing is known yet, so probing would be theatre.
  if (!s || s.isNew) return "teach";
  // Returning mid-progress → recap, then probe. The learner has state worth recalling first.
  if (s.touched || input.hasHistory) return "recap-then-probe";
  return "teach";
}
