/**
 * JournalPanel — a course's session history, from the SESSIONS projection.
 *
 * Read-only. Sessions are listed newest-first with what they actually recorded; nothing is
 * inferred from the absence of a record.
 */
import { useEffect, useState } from "react";
import { fetchJournal, fetchSessionTurns } from "../api.ts";
import { sessionMisconceptionLine } from "../session-note.ts";
import { fetchContinuity, type ContinuityResponse } from "../api.ts";
import { humanMessage } from "../course-error.ts";
import { Markdown } from "./Markdown.tsx";
import type { Journal } from "../types.ts";
import { formatDay } from "../select.ts";
import { humanize } from "../humanize.ts";

export function JournalPanel({ courseId }: { courseId: string }) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The session record currently open, and its content. One open at a time: the list is a list. */
  /**
   * D2 — the opened session shows the REAL conversation.
   *
   * Report #2 (`2026-09-15T05-12-06-337Z-8dc4972f`): "shows back end thoughts instead of the conversation we
   * had as expected". It used to fetch the session RECORD and print it in a `<pre>` — a wall of markdown with
   * absolute paths, `MIS-001` ids and `**Decision:** Hold at 🟥`. Owner's decision: "show the full real
   * transcript for continuity. It's a lot easier on the brain."
   */
  const [opened, setOpened] = useState<{
    file: string;
    turns?: { role: string; text: string }[];
    available?: boolean;
    error?: string;
  } | null>(null);
  /** Present-tense state, so a record's claims can be shown against what is true now. */
  const [continuity, setContinuity] = useState<ContinuityResponse | null>(null);

  async function open(file: string) {
    if (opened?.file === file) {
      setOpened(null);
      return;
    }
    setOpened({ file });
    try {
      const res = await fetchSessionTurns(courseId, file);
      setOpened({ file, turns: res.turns, available: res.available });
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
        <p className="tray-empty">Could not read the journal. {humanMessage(error)}</p>
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
              <div className="session-body reading session-transcript">
                {opened.error ? (
                  <p className="notice">{humanMessage(opened.error)}</p>
                ) : opened.available === false ? (
                  // The record exists but its transcript is gone. Said plainly rather than shown as an empty
                  // box, which would read as a rendering bug.
                  <p className="tray-empty">This session&rsquo;s transcript is no longer available.</p>
                ) : (opened.turns ?? []).length === 0 ? (
                  <p className="tray-empty">This session recorded no conversation.</p>
                ) : (
                  (opened.turns ?? []).map((turn, i) => (
                    <div className={`session-turn session-turn-${turn.role}`} key={i}>
                      <span className="eyebrow">{turn.role === "user" ? "You" : "Tutor"}</span>
                      <Markdown text={turn.text} />
                    </div>
                  ))
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
