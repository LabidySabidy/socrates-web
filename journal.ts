/**
 * journal.ts — reads a course's session history.
 *
 * Layer 0 is pi's transcript (referenced, never read). Layer 1 is `events.jsonl`. Layer 2 is the
 * `SESSIONS/*.md` projection. This module reads layer 2 for content and layer 1 only for counts,
 * because the markdown is the human-readable, stable projection — coupling the client to the raw
 * event schema would tie the UI to the writer's internal shape.
 *
 * Everything degrades: a missing directory yields an empty journal, a malformed log line is
 * counted and skipped, and a filename that is not a session file is refused.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export interface SessionSummary {
  /** File name inside SESSIONS/, used as the id in the API. */
  file: string;
  /** From the filename (UTC), escalated to the body's Started when the file is parsed. */
  startedAt: string;
  endedAt: string | null;
  open: boolean;
  turns: number | null;
  concepts: string[];
  misconceptions: number;
  gaps: number;
  transcript: string | null;
  bytes: number;
}

export interface Journal {
  sessions: SessionSummary[];
  events: {
    /** `events.jsonl` exists. */
    present: boolean;
    count: number;
    malformed: number;
    lastTs: string | null;
    telemetryMissing: number;
  };
  warnings: string[];
}

const SESSION_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})-[0-9a-f]{8}\.md$/;

/** `2026-09-13-0731-01a099ad.md` -> `2026-09-13T07:31:00.000Z`, or null if it isn't a session file. */
export function parseSessionFileName(file: string): string | null {
  const m = SESSION_FILE_RE.exec(basename(file));
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`;
}

export function isSessionFile(file: string): boolean {
  return parseSessionFileName(file) !== null;
}

/** The SESSIONS directory for a course, or null when the course has no learning dir. */
export function sessionsDir(courseDir: string): string | null {
  const dir = join(courseDir, ".agent", "learning", "SESSIONS");
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** Cheap recency for the catalogue: file names only, no file reads. */
export function sessionIndex(courseDir: string): { count: number; lastAt: string | null } {
  const dir = sessionsDir(courseDir);
  if (!dir) return { count: 0, lastAt: null };
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return { count: 0, lastAt: null };
  }
  const dates = files.map(parseSessionFileName).filter((d): d is string => Boolean(d));
  return {
    count: dates.length,
    lastAt: dates.length === 0 ? null : dates.slice().sort().at(-1)!,
  };
}

/** Parse the bullets the writer emits. Tolerant: a line it does not recognise is ignored. */
export function parseSessionMarkdown(file: string, body: string, bytes: number): SessionSummary {
  const fromName = parseSessionFileName(file) ?? "1970-01-01T00:00:00.000Z";
  const grab = (label: string): string | null => {
    const m = new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, "m").exec(body);
    return m ? m[1] : null;
  };

  const status = grab("Status");
  const started = grab("Started");
  const ended = grab("Ended");
  const turnsRaw = grab("Turns");
  const transcript = grab("Transcript");

  // Scan the section's lines rather than matching it with a lazy quantifier: a
  // `(?=^## |\s*$)` lookahead matches an empty body at the blank line after the heading.
  const section = (heading: string): string[] => {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start === -1) return [];
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) break;
      // Only TOP-LEVEL bullets: an indented sub-bullet (e.g. the `corrected:` line under a
      // misconception) belongs to the row above it and must not count as its own row.
      if (lines[i].startsWith("- ")) out.push(lines[i].trim());
    }
    return out;
  };

  // "## Concepts touched" -> "- 🟨 **react-state** — next review in 2d"
  const concepts = section("Concepts touched")
    .map((l) => /\*\*(.+?)\*\*/.exec(l)?.[1])
    .filter((c): c is string => Boolean(c));

  const gaps = section("Recorded gaps").length;

  return {
    file: basename(file),
    startedAt: started && started !== "unknown" ? started : fromName,
    endedAt: ended,
    open: status !== "closed",
    turns: turnsRaw && Number.isFinite(Number(turnsRaw)) ? Number(turnsRaw) : null,
    concepts,
    misconceptions: section("Misconceptions").length,
    gaps,
    transcript,
    bytes,
  };
}

export function readJournal(courseDir: string, opts: { limit?: number } = {}): Journal {
  const warnings: string[] = [];
  const dir = sessionsDir(courseDir);
  const sessions: SessionSummary[] = [];

  if (dir) {
    let files: string[];
    try {
      files = readdirSync(dir).filter(isSessionFile).sort();
    } catch {
      warnings.push("sessions-unreadable");
      files = [];
    }
    for (const file of files) {
      const path = join(dir, file);
      try {
        const body = readFileSync(path, "utf8");
        sessions.push(parseSessionMarkdown(file, body, Buffer.byteLength(body)));
      } catch {
        warnings.push(`session-unreadable:${file}`);
      }
    }
  }

  // newest first — the filename carries a UTC timestamp, so lexical sort is chronological
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const eventsPath = join(courseDir, ".agent", "learning", "events.jsonl");
  const events = {
    present: existsSync(eventsPath),
    count: 0,
    malformed: 0,
    lastTs: null as string | null,
    telemetryMissing: 0,
  };
  if (events.present) {
    try {
      for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as { kind?: unknown; ts?: unknown };
          if (typeof evt.kind !== "string") {
            events.malformed++;
            continue;
          }
          events.count++;
          if (typeof evt.ts === "string" && (events.lastTs === null || evt.ts > events.lastTs)) {
            events.lastTs = evt.ts;
          }
          if (evt.kind === "telemetry_missing") events.telemetryMissing++;
        } catch {
          events.malformed++;
        }
      }
    } catch {
      warnings.push("events-unreadable");
    }
  }

  const limit = opts.limit ?? 50;
  return { sessions: sessions.slice(0, limit), events, warnings };
}

/** One session's markdown, or null when the name is not a session file / does not exist. */
export function readSessionMarkdown(courseDir: string, file: string): string | null {
  if (!isSessionFile(file) || basename(file) !== file) return null;
  const dir = sessionsDir(courseDir);
  if (!dir) return null;
  const path = join(dir, file);
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
