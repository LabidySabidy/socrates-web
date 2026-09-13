/**
 * TelemetryRail — the Cockpit's tutor telemetry, surfaced from real data.
 *
 * Every number here traces to a field: SM-2 comes from SCHEMA.md, the tray from the misconception
 * registry, the memory strength from the SM-2 fields via a documented formula. Nothing is
 * fabricated, and the estimate is labelled as an estimate.
 */
import type { LearningData } from "../types.ts";
import { memoryStrength } from "../memory.ts";
import { MisconceptionTray } from "./MisconceptionTray.tsx";

export function TelemetryRail({
  learning,
  grillHref,
}: {
  learning: LearningData | null;
  /** A concept name is a grill affordance, as it was in the original dashboard. */
  grillHref?: (concept: string) => string;
}) {
  const memory = memoryStrength(learning);
  const concepts = learning?.schema.concepts ?? [];

  return (
    <section className="telemetry" aria-label="Cognitive telemetry">
      <h2>Memory strength (SM-2 estimate)</h2>
      <div className="memory">
        <span className="value num">
          {memory.value === null ? "—" : `${Math.round(memory.value * 100)}%`}
        </span>
      </div>
      <p className="memory note">
        {memory.value === null
          ? `Insufficient data — ${memory.total === 0 ? "no concepts recorded" : "no reviews recorded yet"}.`
          : `Estimate from repetition count, interval, and ease across ${memory.reviewed} of ${memory.total} concepts. Not a measurement of retention.`}
      </p>

      <h2>Spaced repetition</h2>
      {concepts.length === 0 ? (
        <p className="tray-empty">No concepts recorded.</p>
      ) : (
        <table className="sm2-table">
          <thead>
            <tr>
              <th>Concept</th>
              <th className="num">Last</th>
              <th className="num">Next</th>
              <th className="num">Int</th>
              <th className="num">Ease</th>
              <th className="num">Reps</th>
            </tr>
          </thead>
          <tbody>
            {concepts.map((c) => (
              <tr key={c.name}>
                <td>
                  {grillHref ? (
                    <a className="concept-grill" href={grillHref(c.name)} title="grill this concept">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </td>
                <td className="num">{c.sm2.last_tested}</td>
                <td className="num" style={c.due === "due" ? { color: "var(--warning-strong)" } : undefined}>
                  {c.sm2.next_review}
                  {c.due === "due" ? " · due" : ""}
                </td>
                <td className="num">{c.sm2.interval ?? "—"}</td>
                <td className="num">{c.sm2.ease_factor ?? "—"}</td>
                <td className="num">{c.sm2.repetitions ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <MisconceptionTray
        misconceptions={learning?.schema.misconceptions ?? []}
        grillHref={grillHref}
      />
    </section>
  );
}
