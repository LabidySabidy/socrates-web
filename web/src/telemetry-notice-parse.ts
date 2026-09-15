/**
 * Turn a captured telemetry payload into something worth showing the learner.
 *
 * THE OWNER'S REQUEST, from report #5: a distinct background, the detail in quotes, and a line like
 * "misconception identified and added to the list".
 *
 * WHY IT IS CONDITIONAL, and this is the whole design. `misconception` is an OPTIONAL field on `Telemetry`
 * (`pi/extensions/learning/telemetry.ts:85`). Measured across the owner's real courses: 13 `badge` events and
 * 13 `sm2` events carry NO misconception, while 3 `misconception_open` events do. So a single unconditional
 * "misconception identified" notice would have claimed a misconception on 26 of 29 real events — telling the
 * learner something that was never recorded. Two cases, two notices.
 */
import { classifyTelemetry, type TelemetryNotice } from "./telemetry-notice.ts";

export type { TelemetryNotice } from "./telemetry-notice.ts";

/**
 * Parse one captured block into a notice, or null when it is nothing worth interrupting the chat for.
 *
 * Returns null rather than a fallback notice for a plain status update: the badge already appears in the
 * mastery rail and the module rows, so repeating it in the conversation is noise. A MISCONCEPTION is different
 * — nothing else in the app states what the learner believed, so it earns its place in the transcript.
 */
export function telemetryNotice(raw: string): TelemetryNotice | null {
  let parsed: unknown;
  try {
    // The captured body may include a code fence or trailing commas from the model's formatting.
    const cleaned = raw
      .replace(/^```(?:json|JSON)?\s*/m, "")
      .replace(/```\s*$/m, "")
      .replace(/,\s*([}\]])/g, "$1")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return null; // unparseable telemetry is not learner-facing content
  }
  return classifyTelemetry(parsed);
}
