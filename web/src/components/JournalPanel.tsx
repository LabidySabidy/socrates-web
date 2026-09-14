/**
 * JournalPanel — a course's session history, from the SESSIONS projection.
 *
 * Read-only. Sessions are listed newest-first with what they actually recorded; nothing is
 * inferred from the absence of a record.
 */
import { useEffect, useState } from "react";
import { fetchJournal, fetchSessionMarkdown } from "../api.ts";
import { sessionMisconceptionLine, stripAbsolutePaths } from "../session-note.ts";
import { fetchContinuity, type ContinuityResponse } from "../api.ts";
import type { Journal } from "../types.ts";
import { formatDay } from "../select.ts";
import { humanize } from "../humanize.ts";

export function JournalPanel({ courseId }: { courseId: string }) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The session record currently open, and its content. One open at a time: the list is a list. */
  const [opened, setOpened] = useState<{ file: string; text?: string; error?: string } | null>(null);
  /** Present-tense state, so a record's claims can be shown against what is true now. */
  const [continuity, setContinuity] = useState<ContinuityResponse | null>(null);

  async function open(file: string) {
    if (opened?.file === file) {
      setOpened(null);
      return;
    }
    setOpened({ file });
    try {
      const text = await fetchSessionMarkdown(courseId, file);
      setOpened({ file, text });
    } catch (err) {
      setOpened({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  useEffect(() => {
    fetchContinuity(courseId)
      .then(setContinuity)
      .catch(() => {
        /* no continuity reads as "nothing to reconcile", which is the honest default */
      });
  }, [courseId]);

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
        journal.sessions.map((s) => {
          // The record's own rows, resolved against the registry's present tense.
          const view = continuity?.sessions.find((v) => v.file === s.file);
          const rows = (view?.misconceptions ?? []).map((m) => ({
            id: m.id,
            ...sessionMisconceptionLine(m),
          }));
          return (
          <article className="session" key={s.file}>
            <header>
              <span className="session-when">{formatDay(s.startedAt)}</span>
              {s.turns !== null ? <span className="session-turns num">{s.turns} turns</span> : null}
              {s.open ? <span className="session-open">open</span> : null}
              {/* 3c — the record itself was inert while the endpoint that serves it existed. */}
              <button type="button" className="session-open-link" onClick={() => void open(s.file)}>
                {opened?.file === s.file ? "Close" : "Open"}
              </button>
            </header>
            {opened?.file === s.file ? (
              <div className="session-body reading">
                {opened.error ? (
                  <p className="notice">{opened.error}</p>
                ) : (
                  <pre className="session-md">{stripAbsolutePaths(opened.text ?? "")}</pre>
                )}
              </div>
            ) : null}
            {s.concepts.length > 0 ? (
              <p className="session-body">Covered {s.concepts.map(humanize).join(", ")}</p>
            ) : null}
            {/* 3b — a belief recorded here is annotated with where it stands NOW. Opening an early
                session must not read as though the learner still holds what they have since fixed. */}
            {rows.length > 0 ? (
              <ul className="session-misconceptions">
                {rows.map((row, i) => (
                  <li key={`${row.id}-${i}`} className={row.sinceResolved ? "resolved" : undefined}>
                    <span className="eyebrow">{row.id}</span> {row.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {s.gaps > 0 ? (
              <p className="session-gap">
                {s.gaps} recorded telemetry gap{s.gaps === 1 ? "" : "s"}
              </p>
            ) : null}
          </article>
          );
        })
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
