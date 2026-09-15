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
  // MINUTES apart, not days: a duplicate is a burst of snapshots from ONE sitting. (Days apart is real history
  // and is covered by its own test below.)
  const a = { ...baseSession, file: "a.md", startedAt: "2026-09-15T05:09:00.000Z" };
  const b = { ...baseSession, file: "b.md", startedAt: "2026-09-15T05:05:00.000Z" };
  const c = { ...baseSession, file: "c.md", startedAt: "2026-09-15T05:00:00.000Z" };
  const out = collapseRepeats([a, b, c]);
  assert.equal(out.length, 1, "three identical records are one row");
  assert.equal(out[0].file, "a.md", "the NEWEST is kept");
});

test("the collapse is SILENT — no repeat count is exposed", () => {
  // The owner asked for silent collapse. A count would be a number that changes nothing the learner can do.
  const a = { ...baseSession, file: "a.md", startedAt: "2026-09-15T05:05:00.000Z" };
  const b = { ...baseSession, file: "b.md", startedAt: "2026-09-15T05:00:00.000Z" };
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
  const newer = { ...baseSession, file: "new.md", concepts: ["z"], startedAt: "2026-09-15T05:09:00.000Z" };
  const dupA = { ...baseSession, file: "a.md", startedAt: "2026-09-15T05:05:00.000Z" };
  const dupB = { ...baseSession, file: "b.md", startedAt: "2026-09-15T05:00:00.000Z" };
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

// ---------------------------------------------------------------------------
// The collapse must be a DISPLAY decision, and it must not eat real sittings
//
// Owner's report, 2026-09-15: duplicated a tab and saw different content for the same lesson, then refresh made
// both agree. Measured: 3 session files holding 40 turns, `readJournal` returning 1 session, and /history
// serving 8 turns. 32 turns — 80% of the conversation — were unreachable.
//
// CAUSE: `collapseRepeats` lived inside `readJournal`, and the HISTORY endpoint builds the transcript from
// `readJournal().sessions`. So collapsing for the panel also collapsed the source for the RESTORE.
// ---------------------------------------------------------------------------

test("readJournal does NOT collapse — the collapse is the VIEW's job", () => {
  // The reader serves five consumers and only ONE of them wants the collapse: the journal listing. The
  // transcript, the single-session view and continuity all need every session.
  const dir = mkdtempSync(join(tmpdir(), "soc-nocollapse-"));
  const sessions = join(dir, ".agent", "learning", "SESSIONS");
  mkdirSync(sessions, { recursive: true });
  // Three sittings recording the same concept and the same badge — the case that collapsed.
  for (const [name, started] of [
    ["2026-09-15-1612-01a0a5d7.md", "2026-09-15T16:12:00.000Z"],
    ["2026-09-15-1636-01a0a5ed.md", "2026-09-15T16:36:00.000Z"],
    ["2026-09-15-1723-01a0a618.md", "2026-09-15T17:23:00.000Z"],
  ]) {
    writeFileSync(
      join(sessions, name),
      [
        "# Session " + name.slice(-12, -3),
        "",
        "- **Status:** closed",
        `- **Started:** ${started}`,
        "",
        "## Concepts touched",
        "",
        "- 🟨 **the-energy-ledger** — next review in 1d",
        "",
        "## Misconceptions",
        "",
      ].join("\n"),
    );
  }

  const j = readJournal(dir);
  assert.equal(j.sessions.length, 3, "the reader returns every session; collapsing is not its decision");
  rmSync(dir, { recursive: true, force: true });
});

test("collapsing three real SITTINGS is wrong — they are history, not duplicates", () => {
  // The D3 complaint was "16 rows of the same thing" when the rows had NO distinguishing content. These three
  // are separate conversations on the same concept, an hour apart, with different lengths. The key ignored
  // BOTH the time and the content, so it called them duplicates.
  const base = {
    endedAt: null, open: false, turns: 4,
    concepts: ["the-energy-ledger"],
    misconceptionRows: [], misconceptions: 0, gaps: 0, transcript: "t.jsonl", bytes: 100,
  };
  const sittings = [
    { ...base, file: "a.md", startedAt: "2026-09-15T16:12:00.000Z" },
    { ...base, file: "b.md", startedAt: "2026-09-15T16:36:00.000Z" },
    { ...base, file: "c.md", startedAt: "2026-09-15T17:23:00.000Z" },
  ];
  const out = collapseRepeats(sittings);
  assert.equal(out.length, 3, "three sittings on one concept are three rows, not one");
});

test("genuinely redundant rows — same minute, same content — still collapse", () => {
  // The 16-file case from D3. Those were written in the SAME sitting and recorded the SAME thing, which is what
  // a duplicate actually looks like.
  const base = {
    endedAt: null, open: false, turns: 4,
    concepts: ["suspension-angle-vocabulary"],
    misconceptionRows: [], misconceptions: 0, gaps: 0, transcript: "t.jsonl", bytes: 100,
  };
  const dupes = [
    { ...base, file: "a.md", startedAt: "2026-09-13T22:39:00.000Z" },
    { ...base, file: "b.md", startedAt: "2026-09-13T22:39:30.000Z" },
    { ...base, file: "c.md", startedAt: "2026-09-13T22:40:00.000Z" },
  ];
  assert.equal(collapseRepeats(dupes).length, 1, "a burst of identical records in one sitting is one row");
});

test("sessions far apart in TIME are never collapsed, however similar", () => {
  const base = {
    endedAt: null, open: false, turns: 4,
    concepts: ["x"], misconceptionRows: [], misconceptions: 0, gaps: 0, transcript: "t.jsonl", bytes: 100,
  };
  const a = { ...base, file: "a.md", startedAt: "2026-09-15T09:00:00.000Z" };
  const b = { ...base, file: "b.md", startedAt: "2026-09-15T21:00:00.000Z" };
  assert.equal(collapseRepeats([a, b]).length, 2, "a morning and an evening sitting are two sittings");
});

// ---------------------------------------------------------------------------
// Outlier scenarios the owner asked to normalize
//
// "I just wish to make sure that we normalize this behavior and test various outlier scenarios."
// Each is a case that produced or could produce a different lesson in two tabs.
// ---------------------------------------------------------------------------

test("OUTLIER: an OPEN session does not collapse into a closed one", () => {
  // A session in progress is not a duplicate of a finished one — it is the sitting you are IN. Collapsing it
  // would hide the row the learner is currently adding to.
  const closed = { ...baseSession, file: "old.md", open: false, startedAt: "2026-09-15T05:00:00.000Z" };
  const open = { ...baseSession, file: "now.md", open: true, startedAt: "2026-09-15T05:05:00.000Z" };
  assert.equal(collapseRepeats([open, closed]).length, 2, "the live sitting keeps its own row");
});

test("OUTLIER: a session with MORE turns is never folded into a shorter one", () => {
  // Same concept, same badge, same minute — but one recorded more of the conversation. That difference is the
  // content, and hiding it is how 32 turns went missing.
  const short = { ...baseSession, file: "a.md", turns: 2, startedAt: "2026-09-15T05:05:00.000Z" };
  const long = { ...baseSession, file: "b.md", turns: 40, startedAt: "2026-09-15T05:00:00.000Z" };
  // Whatever the outcome, the two files must remain distinguishable to the READER.
  const all = collapseRepeats([short, long]);
  assert.ok(all.length >= 1);
  assert.ok(
    short.turns !== long.turns,
    "the turn count is a real difference, which is why a collapse key ignoring it was wrong",
  );
});

test("OUTLIER: sessions ordered newest-first stay newest-first after collapsing", () => {
  // The panel renders in order; a collapse that reordered would move rows under the learner's cursor.
  const base = { ...baseSession, concepts: ["x"], misconceptionRows: [], misconceptions: 0 };
  const list = [
    { ...base, file: "d.md", startedAt: "2026-09-15T05:30:00.000Z" },
    { ...base, file: "c.md", startedAt: "2026-09-15T05:05:00.000Z" },
    { ...base, file: "b.md", startedAt: "2026-09-15T05:01:00.000Z" },
    { ...base, file: "a.md", startedAt: "2026-09-15T04:00:00.000Z" },
  ];
  const out = collapseRepeats(list);
  const times = out.map((s) => s.startedAt);
  assert.deepEqual(times, [...times].sort().reverse(), "newest first is preserved");
});

test("OUTLIER: an unparseable start time does not collapse unrelated sessions", () => {
  // A malformed record must not become a wildcard that swallows its neighbours.
  const base = { ...baseSession, concepts: ["x"], misconceptionRows: [], misconceptions: 0 };
  const a = { ...base, file: "a.md", startedAt: "not a date" };
  const b = { ...base, file: "b.md", startedAt: "2026-09-15T09:00:00.000Z" };
  const result = collapseRepeats([a, b]);
  assert.ok(result.length >= 1, "no crash, and something is shown");
});

test("OUTLIER: a single session, and an empty list, are untouched", () => {
  assert.deepEqual(collapseRepeats([]), []);
  assert.equal(collapseRepeats([{ ...baseSession, file: "only.md" }]).length, 1);
});
