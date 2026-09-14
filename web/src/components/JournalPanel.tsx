/**
 * JournalPanel — a course's session history, from the SESSIONS projection.
 *
 * Read-only. Sessions are listed newest-first with what they actually recorded; nothing is
 * inferred from the absence of a record.
 */
import { useEffect, useState } from "react";
import { fetchJournal } from "../api.ts";
import type { Journal } from "../types.ts";
import { formatDay } from "../select.ts";
import { humanize } from "../humanize.ts";

export function JournalPanel({ courseId }: { courseId: string }) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setJournal(null);
    setError(null);
    fetchJournal(courseId)
      .then((j) => {
        if (alive) setJournal(j);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  if (error) {
    return (
      <section className="journal" aria-label="Sessions">
        <h2>Sessions</h2>
        <p className="tray-empty">Could not read the journal: {error}</p>
      </section>
    );
  }

  if (!journal) {
    return (
      <section className="journal" aria-label="Sessions">
        <h2>Sessions</h2>
        <p className="tray-empty">Loading…</p>
      </section>
    );
  }

  return (
    <section className="journal" aria-label="Sessions">
      <h2>Sessions{journal.sessions.length > 0 ? ` · ${journal.sessions.length}` : ""}</h2>

      {journal.sessions.length === 0 ? (
        <p className="tray-empty">
          No sessions recorded yet. They are written when a tutor session runs in this course.
        </p>
      ) : (
        journal.sessions.map((s) => (
          <article className="session" key={s.file}>
            <header>
              <span className="session-when">{formatDay(s.startedAt)}</span>
              {s.turns !== null ? <span className="session-turns num">{s.turns} turns</span> : null}
              {s.open ? <span className="session-open">open</span> : null}
            </header>
            {s.concepts.length > 0 ? (
              <p className="session-body">Covered {s.concepts.map(humanize).join(", ")}</p>
            ) : null}
            {s.misconceptions > 0 ? (
              <p className="session-body">
                {s.misconceptions} misconception record{s.misconceptions === 1 ? "" : "s"}
              </p>
            ) : null}
            {s.gaps > 0 ? (
              <p className="session-gap">
                {s.gaps} recorded telemetry gap{s.gaps === 1 ? "" : "s"}
              </p>
            ) : null}
          </article>
        ))
      )}

      {journal.events.present ? (
        <p className="journal-foot eyebrow">
          event log: {journal.events.count} events
          {journal.events.malformed > 0 ? ` · ${journal.events.malformed} unreadable` : ""}
          {journal.events.telemetryMissing > 0
            ? ` · ${journal.events.telemetryMissing} telemetry gaps`
            : ""}
        </p>
      ) : null}

      {journal.warnings.length > 0 ? (
        <p className="journal-foot eyebrow">warnings: {journal.warnings.join(", ")}</p>
      ) : null}
    </section>
  );
}
