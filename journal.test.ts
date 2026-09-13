/**
 * journal.test.ts — T-035: reading a course's session history.
 *
 * Content comes from the committed `course-with-journal` fixture; log-shape cases build their own
 * temp dirs, because `events.jsonl` is a runtime artifact that fixtures must not ship.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSessionFile,
  parseSessionFileName,
  parseSessionMarkdown,
  readJournal,
  readSessionMarkdown,
  sessionIndex,
} from "./journal.ts";

const FIXTURES = join(import.meta.dirname, "test", "fixtures");
const WITH_JOURNAL = join(FIXTURES, "course-with-journal");

function tmp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("session file names carry a parseable UTC timestamp", () => {
  assert.equal(parseSessionFileName("2026-09-10-0741-01a099ad.md"), "2026-09-10T07:41:00.000Z");
  assert.equal(isSessionFile("2026-09-10-0741-01a099ad.md"), true);
  assert.equal(parseSessionFileName("notes.md"), null);
  assert.equal(parseSessionFileName("2026-09-10-0741-nothex.md"), null);
  assert.equal(parseSessionFileName("2026-09-10-0741-01A099AD.md"), null, "lowercase hex only");
});

test("sessionIndex reports count and recency from file names alone", (t) => {
  assert.deepEqual(sessionIndex(WITH_JOURNAL), {
    count: 2,
    lastAt: "2026-09-10T07:41:00.000Z",
  });

  const empty = tmp(t);
  assert.deepEqual(sessionIndex(empty), { count: 0, lastAt: null }, "no learning dir at all");
});

test("parseSessionMarkdown reads the bullets the writer emits", () => {
  const body = readFileSync(
    join(WITH_JOURNAL, ".agent/learning/SESSIONS/2026-09-08-0900-0a1b2c3d.md"),
    "utf8",
  );
  const s = parseSessionMarkdown("2026-09-08-0900-0a1b2c3d.md", body, Buffer.byteLength(body));

  assert.equal(s.startedAt, "2026-09-08T09:00:00.000Z");
  assert.equal(s.endedAt, "2026-09-08T09:52:11.000Z");
  assert.equal(s.open, false);
  assert.equal(s.turns, 4);
  assert.deepEqual(s.concepts, ["journal-concept"]);
  assert.equal(s.misconceptions, 1);
  assert.match(s.transcript!, /\.jsonl$/);
});

test("an unfinished session reports open with no turn count", () => {
  const body = readFileSync(
    join(WITH_JOURNAL, ".agent/learning/SESSIONS/2026-09-10-0741-01a099ad.md"),
    "utf8",
  );
  const s = parseSessionMarkdown("2026-09-10-0741-01a099ad.md", body, 1);
  assert.equal(s.open, true);
  assert.equal(s.endedAt, null);
  assert.equal(s.turns, null);
  assert.deepEqual(s.concepts, [], "the none-recorded placeholder is not a concept");
});

test("readJournal on the fixture returns sessions newest-first with events absent", () => {
  const journal = readJournal(WITH_JOURNAL);
  assert.deepEqual(journal.warnings, []);
  assert.deepEqual(
    journal.sessions.map((s) => s.file),
    ["2026-09-10-0741-01a099ad.md", "2026-09-08-0900-0a1b2c3d.md"],
  );
  assert.equal(journal.events.present, false, "fixtures ship no runtime log");
  assert.equal(journal.events.count, 0);
  assert.equal(journal.sessions[0].open, true);
  assert.equal(journal.sessions[1].turns, 4);
});

test("a course with no journal degrades to an empty list, not an error", (t) => {
  const journal = readJournal(tmp(t));
  assert.deepEqual(journal.sessions, []);
  assert.equal(journal.events.present, false);
  assert.deepEqual(journal.warnings, []);
});

test("a malformed log line is counted and skipped, and telemetry_missing is tallied", (t) => {
  const dir = tmp(t);
  const ld = join(dir, ".agent", "learning");
  mkdirSync(ld, { recursive: true });
  writeFileSync(
    join(ld, "events.jsonl"),
    [
      '{"v":1,"ts":"2026-09-10T07:41:02.000Z","kind":"session_start"}',
      "{not json",
      '{"ts":"2026-09-10T07:41:03.000Z"}',
      '{"v":1,"ts":"2026-09-10T07:42:00.000Z","kind":"telemetry_missing"}',
      '{"v":1,"ts":"2026-09-10T07:50:00.000Z","kind":"session_end"}',
      "",
    ].join("\n"),
  );

  const journal = readJournal(dir);
  assert.equal(journal.events.present, true);
  assert.equal(journal.events.count, 3, "three well-formed events");
  assert.equal(journal.events.malformed, 2, "unparseable line plus a line with no kind");
  assert.equal(journal.events.telemetryMissing, 1);
  assert.equal(journal.events.lastTs, "2026-09-10T07:50:00.000Z");
});

test("readSessionMarkdown refuses traversal and non-session names", () => {
  assert.ok(readSessionMarkdown(WITH_JOURNAL, "2026-09-08-0900-0a1b2c3d.md"));
  assert.equal(readSessionMarkdown(WITH_JOURNAL, "../SCHEMA.md"), null);
  assert.equal(readSessionMarkdown(WITH_JOURNAL, "..\\SCHEMA.md"), null);
  assert.equal(readSessionMarkdown(WITH_JOURNAL, "SCHEMA.md"), null, "not a session file name");
  assert.equal(readSessionMarkdown(WITH_JOURNAL, "2026-01-01-0000-deadbeef.md"), null, "absent");
});

test("readJournal caps how many sessions it returns", () => {
  assert.equal(readJournal(WITH_JOURNAL, { limit: 1 }).sessions.length, 1);
});
