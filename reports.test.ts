/**
 * reports.test.ts — the bug-report store.
 *
 * Every test points `SOCRATES_HOME` at a temp directory, because this feature's own output would otherwise
 * become noise in the real reports store — the tool meant to reduce noise.
 *
 * What a unit test CANNOT cover is stated plainly rather than implied: the browser permission dialog, the
 * frame grab, and the thumbnail are verified by hand (see the report). What is tested here is everything
 * that does not need a DOM: the JSON shape, the size cap, path safety, ordering, and both-file deletion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { storeRoot } from "./course-store.ts";
import {
  MAX_IMAGE_BYTES,
  deleteReport,
  imagePath,
  listReports,
  readFullReport,
  redactPaths,
  reportStem,
  reportsRoot,
  saveReport,
  shortId,
} from "./reports.ts";

function env(t: { after(fn: () => void): void }): NodeJS.ProcessEnv {
  // `SOCRATES_REPORTS` is deliberately NOT set: the point is that reports derive from `SOCRATES_HOME`, and
  // an explicit override would hide a broken derivation — which is how the real-store leak got through.
  const home = mkdtempSync(join(tmpdir(), "soc-reports-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { ...process.env, SOCRATES_HOME: home };
}

const at = new Date("2026-09-14T12:30:05.123Z");

test("the reports store is derived from the courses store, so SOCRATES_HOME overrides both", (t) => {
  // The bug this catches, which happened: `reportsRoot` was built from `homedir()` independently, so
  // `SOCRATES_HOME` did NOT redirect it and a test run wrote three files into the owner's REAL reports
  // store. They were deleted. The requirement is that it derives from `storeRoot()`.
  const e = env(t);
  assert.ok(reportsRoot(e).includes("soc-reports-"), "the override is honoured");
  assert.ok(!reportsRoot(e).includes(join(".socrates", "reports")), "and it is not the real store");

  // NOT inside a course. `storeRoot()` returns the courses DIRECTORY, so an override means reports sit
  // beside it inside the redirected store; the default puts them beside `~/.socrates/courses`.
  const courses = storeRoot(e);
  assert.notEqual(reportsRoot(e), courses, "the reports root must not BE the courses dir");
  assert.ok(reportsRoot(e).startsWith(courses), "with an override it lives inside the redirected store");
  assert.ok(!reportsRoot(e).includes(join(courses, "courses")), "and is not nested oddly");

  // The default lands beside the default courses store, under the same root.
  assert.equal(dirname(reportsRoot({})), dirname(storeRoot({})), "same parent as the default courses store");
  assert.equal(reportsRoot({}).endsWith("reports"), true);
});

test("writing a report never touches the real store when SOCRATES_HOME is set", (t) => {
  // The behavioural form of the same guarantee, since the leak was a WRITE rather than a read.
  const e = env(t);
  const real = join(resolve(homedir(), ".socrates"), "reports");
  const before = existsSync(real) ? readdirSync(real).length : 0;
  saveReport({ whatIsWrong: "must not leak", route: "#/home", image: null, now: at, id: "0badf00d" }, e);
  const after = existsSync(real) ? readdirSync(real).length : 0;
  assert.equal(after, before, "the real reports store must gain nothing");
  assert.equal(listReports(e).length, 1, "and the temp store gained the report");
});

test("a report round-trips WITH an image", (t) => {
  const e = env(t);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const saved = saveReport({ whatIsWrong: "button missing", route: "#/home", image: png, now: at, id: "aaaa1111" }, e);
  assert.equal(saved.ok, true, saved.ok === false ? saved.error : "");

  const stem = reportStem(at, "aaaa1111");
  const back = readFullReport(stem, e);
  assert.ok(back, "the report reads back");
  assert.equal(back!.whatIsWrong, "button missing");
  assert.equal(back!.hasImage, true);
  assert.ok(existsSync(imagePath(stem, e)!), "the PNG was written");
  assert.deepEqual(readFileSync(imagePath(stem, e)!), png, "byte-for-byte");
});

test("a report round-trips WITHOUT an image — the ordinary case when the dialog is dismissed", (t) => {
  const e = env(t);
  const saved = saveReport({ whatIsWrong: "text only", route: "#/home", image: null, now: at, id: "bbbb2222" }, e);
  assert.equal(saved.ok, true, "a failed or skipped capture must never block reporting");
  const stem = reportStem(at, "bbbb2222");
  const back = readFullReport(stem, e);
  assert.equal(back!.hasImage, false);
  assert.equal(imagePath(stem, e), null, "no PNG is written");
});

test("the listing carries no image bytes and no transcript", (t) => {
  const e = env(t);
  const png = Buffer.alloc(4096, 7);
  saveReport({ whatIsWrong: "a", route: "#/home", image: png, transcript: [{ role: "user", text: "hi" }], now: at, id: "cccc3333" }, e);
  const list = listReports(e);
  assert.equal(list.length, 1);
  const raw = JSON.stringify(list);
  assert.ok(!/"transcript"/.test(raw), "a listing must not ship the transcript");
  assert.ok(!/image/.test(raw.replace(/"hasImage"/g, "")), "nor any image field beyond the boolean");
  assert.equal(list[0].hasImage, true, "but it says whether one exists");
});

test("an oversized image is refused with a message, and nothing is written", (t) => {
  const e = env(t);
  const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  const saved = saveReport({ whatIsWrong: "big", route: "#/home", image: huge, now: at, id: "dddd4444" }, e);
  assert.equal(saved.ok, false);
  assert.match(saved.ok === false ? saved.error : "", /limit is 8 MB|MB/, `it says the cap: ${JSON.stringify(saved)}`);
  assert.equal(listReports(e).length, 0, "no report was written for a refused image");
  assert.ok(!existsSync(join(reportsRoot(e), `${reportStem(at, "dddd4444")}.json`)));
});

test("the stored JSON contains no absolute path, no username and no session file", (t) => {
  // GL-019: the owner publishes this repo, so a report must be safe to read or paste.
  const e = env(t);
  const saved = saveReport(
    {
      whatIsWrong: "crashed reading C:\\Users\\Kasim Alam\\.socrates\\courses\\x\\MISSION.md",
      expected: "it should not touch /home/kasim/.socrates/courses/y",
      route: "#/lesson/course/2",
      image: null,
      now: at,
      id: "eeee5555",
    },
    e,
  );
  assert.equal(saved.ok, true);
  const raw = readFileSync(join(reportsRoot(e), `${reportStem(at, "eeee5555")}.json`), "utf8");
  assert.ok(!/Kasim/.test(raw), `the username leaked: ${raw}`);
  assert.ok(!/[A-Za-z]:\\/.test(raw), "no drive path");
  assert.ok(!/\/home\//.test(raw), "no POSIX home path");
  assert.ok(!/MISSION\.md|session|\.jsonl|\.socrates/.test(raw), "no session or course file reference");
  assert.match(raw, /<path>/, "and the text says a path was removed rather than silently vanishing");
});

test("redaction removes paths that contain spaces, and does not reintroduce them", () => {
  // The bug this catches: a naive `\S*` match stopped at the first SPACE, so a path under `C:\Users\<name>`
  // leaked everything after the space — including the username.
  const once = redactPaths("see C:\\Users\\Kasim Alam\\x and /home/kasim/y");
  assert.ok(!/Alam|Kasim/.test(once), `the username leaked: ${once}`);
  assert.ok(!/[A-Za-z]:\\/.test(once), `a drive path survived: ${once}`);
  assert.ok(!/\/home\//.test(once), `a POSIX path survived: ${once}`);
  assert.match(once, /<path>/, "and it says a path was removed");
  // Over-redaction is the SAFE direction: swallowing the word after a path is acceptable, leaving part of
  // the path is not. So this asserts the safety property, not an exact string.
  assert.equal(redactPaths(once), once, "redacting again changes nothing");
});

test("a report with no description is refused — the server-side backstop", (t) => {
  const e = env(t);
  const saved = saveReport({ whatIsWrong: "   ", route: "#/home", image: null, now: at }, e);
  assert.equal(saved.ok, false);
  assert.match(saved.ok === false ? saved.error : "", /description is required/);
  assert.equal(listReports(e).length, 0);
});

test("the list is newest first", (t) => {
  const e = env(t);
  const mk = (iso: string, id: string) =>
    saveReport({ whatIsWrong: id, route: "#/home", image: null, now: new Date(iso), id }, e);
  mk("2026-09-01T00:00:00.000Z", "11111111");
  mk("2026-09-14T00:00:00.000Z", "33333333");
  mk("2026-09-07T00:00:00.000Z", "22222222");
  assert.deepEqual(
    listReports(e).map((r) => r.whatIsWrong),
    ["33333333", "22222222", "11111111"],
  );
});

test("deleting removes BOTH files, leaving no orphan", (t) => {
  const e = env(t);
  saveReport({ whatIsWrong: "x", route: "#/home", image: Buffer.from([1, 2]), now: at, id: "ffff6666" }, e);
  const stem = reportStem(at, "ffff6666");
  assert.ok(existsSync(join(reportsRoot(e), `${stem}.json`)));
  assert.ok(existsSync(join(reportsRoot(e), `${stem}.png`)));

  assert.equal(deleteReport(stem, e), true);
  assert.ok(!existsSync(join(reportsRoot(e), `${stem}.json`)), "the JSON is gone");
  assert.ok(!existsSync(join(reportsRoot(e), `${stem}.png`)), "and so is the PNG — no orphan");
  assert.equal(listReports(e).length, 0);
  assert.equal(deleteReport(stem, e), false, "deleting again reports nothing removed");
});

test("a crafted id cannot walk out of the reports directory", (t) => {
  const e = env(t);
  for (const bad of ["../escape", "..\escape", "a/b", "a\b", "..", ""]) {
    assert.equal(readFullReport(bad, e), null, `${bad} must be refused`);
    assert.equal(imagePath(bad, e), null, `${bad} must not resolve to a path`);
    assert.equal(deleteReport(bad, e), false, `${bad} must not delete anything`);
  }
  // and a legitimate stem still works
  saveReport({ whatIsWrong: "ok", route: "#/home", image: null, now: at, id: "1234abcd" }, e);
  assert.ok(readFullReport(reportStem(at, "1234abcd"), e));
});

test("the transcript is stored as turns and omitted entirely when not attached", (t) => {
  const e = env(t);
  saveReport({
    whatIsWrong: "tutor said X",
    route: "#/lesson/c/1",
    image: null,
    transcript: [
      { role: "user", text: "why?" },
      { role: "assistant", text: "because Y" },
    ],
    now: at,
    id: "99999999",
  }, e);
  const withIt = readFullReport(reportStem(at, "99999999"), e)!;
  assert.equal(withIt.transcript?.length, 2);
  assert.equal(withIt.transcript?.[0].role, "user");
});

test("an unattached transcript is omitted entirely", (t) => {
  const e = env(t);
  saveReport({ whatIsWrong: "no transcript", route: "#/home", image: null, now: at, id: "88888888" }, e);
  const without = readFullReport(reportStem(at, "88888888"), e)!;
  assert.ok(!("transcript" in without), "the key is ABSENT, not null");
});

test("ids are short, hex, and time-ordered in the filename", () => {
  assert.match(shortId(), /^[0-9a-f]{8}$/);
  const stem = reportStem(at, "abcd1234");
  assert.match(stem, /^2026-09-14T12-30-05-123Z-abcd1234$/);
  assert.ok(!stem.includes(":"), "colons are illegal in Windows filenames");
});

test("a missing store lists nothing rather than failing", (t) => {
  const e = env(t);
  assert.deepEqual(listReports(e), [], "no directory, no error");
});
