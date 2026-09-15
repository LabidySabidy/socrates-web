/**
 * What the app says to the learner about a recorded piece of telemetry.
 *
 * TWO CASES, and conflating them is the defect this file exists to prevent:
 *
 *   1. A MISCONCEPTION was opened or resolved. This is worth saying in the conversation, because nothing else
 *      in the app tells the learner what the tutor thinks they got wrong. It is shown with a distinct
 *      background and the description in quotes.
 *
 *   2. A badge or SM-2 change. This is bookkeeping. The mastery rail and the module rows already show it, so
 *      repeating it in the transcript is noise. It produces NO notice.
 *
 * Measured on the owner's real courses: 26 of 29 telemetry events are case 2. An unconditional
 * "misconception identified" would therefore have been wrong 90% of the time.
 */

/** The badge a concept moved to, as the schema allows. */
export type Badge = "🟥" | "🟨" | "🟩" | "🟦";

export interface TelemetryNotice {
  kind: "misconception-open" | "misconception-resolved";
  /** Headline, e.g. "Misconception identified". */
  title: string;
  /** The concept it belongs to, humanised by the caller. */
  concept: string;
  /** The misconception id, when the tutor supplied one. */
  id?: string;
  /** What the learner believed, quoted verbatim from the record. This is the part worth reading. */
  description: string;
  /** How wrong it is — `root` means the idea underneath is wrong, not a slip. */
  severity?: string;
}

interface RawTelemetry {
  concept?: unknown;
  status?: unknown;
  misconception?: { id?: unknown; description?: unknown; status?: unknown; severity?: unknown } | null;
}

const SEVERITY_LABEL: Record<string, string> = {
  root: "the idea underneath is wrong",
  partial: "partly right, partly wrong",
  edge: "right except at the edges",
};

/**
 * Classify a parsed telemetry payload.
 *
 * Returns null for a bare status/SM-2 update: nothing to tell the learner that the rail is not already
 * showing. The tutor's `status` change is real but silent-facing.
 */
export function classifyTelemetry(input: unknown): TelemetryNotice | null {
  const t = input as RawTelemetry;
  if (!t || typeof t !== "object") return null;

  const m = t.misconception;
  if (!m || typeof m !== "object") return null;

  const description = typeof m.description === "string" ? m.description.trim() : "";
  // A misconception with no description has nothing to quote, so showing it would be an empty box — the same
  // class of silent failure the telemetry leak came from.
  if (!description) return null;

  const concept = typeof t.concept === "string" ? t.concept : "";
  const resolved = m.status === "resolved";
  const severity = typeof m.severity === "string" && SEVERITY_LABEL[m.severity] ? m.severity : undefined;

  return {
    kind: resolved ? "misconception-resolved" : "misconception-open",
    title: resolved ? "Misconception resolved" : "Misconception identified",
    concept,
    ...(typeof m.id === "string" && m.id ? { id: m.id } : {}),
    description,
    ...(severity ? { severity } : {}),
  };
}

/** A sentence describing how wrong the misconception is, or null when the tutor gave no severity. */
export function severityNote(severity: string | undefined): string | null {
  if (!severity) return null;
  return SEVERITY_LABEL[severity] ?? null;
}

/**
 * Pull a learning notice out of a stream line, if it carries one.
 *
 * Mirrors `isPassivitySignal` in shape: the server emits `{type:"learning-notice", notice}`, and the client
 * needs a narrow reader rather than casting at the call site.
 */
export function readLearningNotice(event: unknown): TelemetryNotice | null {
  const e = event as { type?: unknown; notice?: unknown } | null;
  if (!e || e.type !== "learning-notice" || !e.notice) return null;
  const n = e.notice as Partial<TelemetryNotice>;
  if (typeof n.title !== "string" || typeof n.description !== "string" || !n.description.trim()) return null;
  if (n.kind !== "misconception-open" && n.kind !== "misconception-resolved") return null;
  return {
    kind: n.kind,
    title: n.title,
    concept: typeof n.concept === "string" ? n.concept : "",
    ...(typeof n.id === "string" && n.id ? { id: n.id } : {}),
    description: n.description,
    ...(typeof n.severity === "string" && n.severity ? { severity: n.severity } : {}),
  };
}
