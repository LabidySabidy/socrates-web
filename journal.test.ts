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
import { parseHistory } from "./history.ts";
import {
  collapseRepeats,
  isSessionFile,
  parseSessionFileName,
  parseSessionMarkdown,
  readJournal,
  readSessionMarkdown,
  sessionIndex,
} from "./journal.ts";

/** A session summary with the fields the collapse compares, so each test varies only what it means to. */
const baseSession = {
  file: "s.md",
  startedAt: "2026-09-15T05:00:00.000Z",
  endedAt: "2026-09-15T05:10:00.000Z",
  open: false,
  turns: 4,
  concepts: ["camber"],
  misconceptionRows: [{ id: "MIS-001", concept: "camber", claimed: "open" as const, summary: "thinks camber is toe" }],
  misconceptions: 1,
  gaps: 0,
  transcript: null,
  bytes: 100,
};

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

// ---------------------------------------------------------------------------
// D3 — the same session recorded many times must appear ONCE
//
// Report #3 (`2026-09-15T05-11-37-371Z-27985e37`): "session repeat and show the same thing repeatedly, has no
// value right now". Measured on the real course: all 16 session files record the SAME unit, the SAME two
// misconceptions and the same "next review in 0d" — 16 unique content hashes but semantically identical rows.
// The owner's decision: collapse SILENTLY, with no repeat count.
// ---------------------------------------------------------------------------

test("consecutive sessions that recorded the SAME thing collapse to one", () => {
  const a = { ...baseSession, file: "a.md", startedAt: "2026-09-15T05:00:00.000Z" };
  const b = { ...baseSession, file: "b.md", startedAt: "2026-09-14T05:00:00.000Z" };
  const c = { ...baseSession, file: "c.md", startedAt: "2026-09-13T05:00:00.000Z" };
  const out = collapseRepeats([a, b, c]);
  assert.equal(out.length, 1, "three identical records are one row");
  assert.equal(out[0].file, "a.md", "the NEWEST is kept");
});

test("the collapse is SILENT — no repeat count is exposed", () => {
  // The owner asked for silent collapse. A count would be a number that changes nothing the learner can do.
  const a = { ...baseSession, file: "a.md", startedAt: "2026-09-15T05:00:00.000Z" };
  const b = { ...baseSession, file: "b.md", startedAt: "2026-09-14T05:00:00.000Z" };
  const out = collapseRepeats([a, b]);
  assert.equal(out.length, 1);
  assert.ok(!("repeats" in out[0]) && !("count" in out[0]), `no repeat field on the summary: ${JSON.stringify(Object.keys(out[0]))}`);
});

test("sessions that recorded DIFFERENT things are all kept", () => {
  // Collapsing distinct sessions would hide real history — the opposite failure, and worse.
  const a = { ...baseSession, file: "a.md", concepts: ["camber"], startedAt: "2026-09-15T05:00:00.000Z" };
  const b = { ...baseSession, file: "b.md", concepts: ["toe"], startedAt: "2026-09-14T05:00:00.000Z" };
  const out = collapseRepeats([a, b]);
  assert.equal(out.length, 2, "different concepts stay separate");
});

test("a session with a DIFFERENT misconception set is kept", () => {
  // The fixture varies the ROWS as well as the count: a summary carrying a count that disagrees with its own
  // rows cannot occur, so testing against one would have been testing an impossible input.
  const a = { ...baseSession, file: "a.md", startedAt: "2026-09-15T05:00:00.000Z" };
  const b = {
    ...baseSession,
    file: "b.md",
    startedAt: "2026-09-14T05:00:00.000Z",
    misconceptionRows: [
      ...baseSession.misconceptionRows,
      { id: "MIS-002", concept: "camber", claimed: "open" as const, summary: "thinks toe is camber" },
    ],
    misconceptions: 2,
  };
  assert.equal(collapseRepeats([a, b]).length, 2, "a different misconception set is a different record");
});

test("order is preserved: the newest identical record wins its position", () => {
  const newer = { ...baseSession, file: "new.md", concepts: ["z"], startedAt: "2026-09-15T05:00:00.000Z" };
  const dupA = { ...baseSession, file: "a.md", startedAt: "2026-09-14T05:00:00.000Z" };
  const dupB = { ...baseSession, file: "b.md", startedAt: "2026-09-13T05:00:00.000Z" };
  const out = collapseRepeats([newer, dupA, dupB]);
  assert.deepEqual(out.map((s) => s.file), ["new.md", "a.md"]);
});

test("an empty list and a single session are returned unchanged", () => {
  assert.deepEqual(collapseRepeats([]), []);
  const one = [{ ...baseSession, file: "a.md" }];
  assert.equal(collapseRepeats(one).length, 1);
});

test("the session RECORD is not what a learner reads (D2 regression guard)", () => {
  // Report #2 (`…8dc4972f`): "shows back end thoughts instead of the conversation we had as expected".
  // The record carries the tutor's bookkeeping — absolute paths, MIS- ids, decision lines — and must never be
  // the thing rendered in the panel. This pins that the transcript reader produces none of it.
  const record = readFileSync(join(WITH_JOURNAL, ".agent", "learning", "SESSIONS", "2026-09-08-0900-0a1b2c3d.md"), "utf8");
  assert.match(record, /^# Session/, "precondition: the record really does carry the raw markdown");
  assert.match(record, /\*\*Transcript:\*\*/, "precondition: and it really does carry a path line");

  const entry = (role: string, content: unknown) => JSON.stringify({ type: "message", message: { role, content } });
  const turns = parseHistory(
    [
      entry("user", [{ type: "text", text: "what is camber?" }]),
      entry("assistant", [{ type: "text", text: "The wheel's lean angle." }]),
    ].join(String.fromCharCode(10)),
  );
  const shown = JSON.stringify(turns);
  for (const leak of ["# Session", "MIS-", "**Transcript:**", "**Decision:**", "C:\\\\"]) {
    assert.ok(!shown.includes(leak), `the transcript must not carry "${leak}": ${shown}`);
  }
});
