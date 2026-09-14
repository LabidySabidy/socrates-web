/**
 * reports.ts — the bug-report store.
 *
 * BESIDE THE COURSES, NOT INSIDE ONE. A report is not course data: a defect in the top bar or on the home
 * page belongs to no course, and a course directory can be RENAMED (the B3 work), so a report filed under
 * one would move or orphan. The directory is derived the same way `storeRoot()` is, so `SOCRATES_HOME`
 * overrides it in tests exactly as it does for courses.
 *
 * Layout: `<reports>/<ISO-timestamp>-<short-id>.json` and, when there is a frame, the same stem `.png`.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THE STORED JSON: any absolute path, any session file path, any cwd. The
 * owner publishes this repo (GL-019), so a report must be safe to read, paste or commit. Verified by test,
 * not assumed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { storeRoot } from "./course-store.ts";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** One turn of the conversation the reporter chose to attach. */
export interface ReportTurn {
  role: "user" | "assistant";
  text: string;
}

export interface Report {
  id: string;
  /** ISO-8601, used for ordering. The filename carries it too, so a listing needs no parsing to sort. */
  at: string;
  /** REQUIRED: what is wrong. */
  whatIsWrong: string;
  /** Optional: what the reporter expected instead. */
  expected: string;
  /** The hash at capture time, e.g. `#/lesson/course/2`. */
  route: string;
  /** Present only when the route identified them. */
  course: string | null;
  unit: number | null;
  /** The served bundle hash, so a report can be tied to the build it came from. */
  appVersion: string | null;
  hasImage: boolean;
  /** Omitted entirely when the reporter did not attach it. */
  transcript?: ReportTurn[];
}

/** The listing shape: everything except the bytes and the transcript. A list must not ship megabytes. */
export type ReportSummary = Omit<Report, "transcript">;

/**
 * The reports directory: a SIBLING of the courses directory.
 *
 * `storeRoot()` returns `<SOCRATES_HOME>` or `~/.socrates/courses`, so the reports root is that path with
 * `courses` swapped for `reports` — derived rather than hard-coded, so both are overridden together.
 */
export function reportsRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SOCRATES_REPORTS) return resolve(env.SOCRATES_REPORTS);
  // Derived from `storeRoot()`, so ONE env var redirects both — but the shape differs between the two cases
  // and getting it wrong is not cosmetic. `storeRoot()` returns `<SOCRATES_HOME>` verbatim when set (it IS
  // the courses directory) and `~/.socrates/courses` otherwise. Taking `dirname()` of it unconditionally made
  // every temp store resolve to the SAME `os.tmpdir()/reports`, so tests shared one directory and 11 reports
  // accumulated; and building it from `homedir()` independently (the first attempt) meant tests wrote into
  // the owner's REAL store, which happened and the files were deleted.
  //
  // So: when overridden, reports sit INSIDE the redirected store; otherwise beside the default courses dir.
  if (env.SOCRATES_HOME) return join(storeRoot(env), "reports");
  return join(dirname(storeRoot(env)), "reports");
}

/**
 * An image larger than this is refused rather than written.
 *
 * Chosen at 8 MiB: a 1920x1080 PNG of a text-heavy app screen lands around 200–600 KB, and a full-page
 * capture of a long lesson around 1–2 MB. 8 MiB leaves generous headroom while making it impossible for one
 * stray 30 MB capture to fill the store. The limit is enforced on the DECODED byte length, not the base64
 * string length, because base64 inflates by ~33% and a cap checked on the encoded form would be a lie.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type SaveResult =
  | { ok: true; report: ReportSummary }
  | { ok: false; error: string };

/** A filename-safe id: time-ordered, short, and impossible to collide with a path separator. */
export function reportStem(at: Date, id: string): string {
  // `2026-09-14T12-30-05-123Z` — colons are illegal on Windows, so they become dashes.
  const stamp = at.toISOString().replace(/:/g, "-").replace(/\./g, "-");
  return `${stamp}-${id}`;
}

/** A short random id. Not a uuid: this is a local testing tool, and 8 hex is plenty for one person. */
export function shortId(random: () => number = Math.random): string {
  return Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
}

/**
 * Strip anything that could carry a path or a username out of free text.
 *
 * The store is already free of paths by construction, but the two TEXT FIELDS are the reporter's own words
 * and can contain anything — including a pasted path, which is exactly what someone does when reporting a
 * file-related bug. This is a redaction at the point of writing, and it is deliberately the same shape as
 * `web/src/session-note.ts`'s rule so the two cannot drift in intent.
 */
export function redactPaths(text: string): string {
  // A path can CONTAIN spaces (`C:\Users\Kasim Alam\x`), so stopping at the first space leaked the rest of it
  // — measured: "see C:\Users\Kasim Alam\x" became "see <path> Alam\x". The match runs to the end of the
  // path instead: a run of path-ish characters, spaces included.
  const PATHISH = String.raw`[A-Za-z0-9 _.,\\/:-]+`;
  return text
    .replace(new RegExp(`[A-Za-z]:\\\\${PATHISH}`, "g"), "<path>")
    .replace(new RegExp(`/(?:home|Users|var|tmp)/${PATHISH}`, "g"), "<path>")
    .replace(new RegExp(`\\\\\\\\${PATHISH}`, "g"), "<path>")
    // Whitespace or punctuation caught at the end is not part of the path.
    .replace(/<path>[\s.,;:]+/g, "<path> ")
    .trimEnd();
}

/** Every report, newest first, without bytes. */
export function listReports(env: NodeJS.ProcessEnv = process.env): ReportSummary[] {
  const dir = reportsRoot(env);
  if (!existsSync(dir)) return [];
  const out: ReportSummary[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const meta = readReport(name.replace(/\.json$/, ""), env);
    if (meta) out.push(meta);
  }
  // Newest first. The filename is time-ordered, but sorting on `at` is what the contract says.
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** One report by stem (the filename without extension). */
export function readReport(stem: string, env: NodeJS.ProcessEnv = process.env): ReportSummary | null {
  // Refuse anything that is not a plain stem, so a crafted id cannot walk out of the directory.
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) return null;
  const file = join(reportsRoot(env), `${stem}.json`);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Report;
    // The transcript is STRIPPED here, not merely typed away: returning the parsed object whole shipped
    // the conversation in every listing, which is exactly what the listing contract forbids.
    const { transcript: _drop, ...summary } = parsed;
    return summary;
  } catch {
    return null;
  }
}

/** One report including the transcript. */
export function readFullReport(stem: string, env: NodeJS.ProcessEnv = process.env): Report | null {
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) return null;
  const file = join(reportsRoot(env), `${stem}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Report;
  } catch {
    return null;
  }
}

/** The PNG path for a stem, or null when there is no image. */
export function imagePath(stem: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) return null;
  const file = join(reportsRoot(env), `${stem}.png`);
  return existsSync(file) ? file : null;
}

export interface SaveInput {
  whatIsWrong: string;
  expected?: string;
  route: string;
  course?: string | null;
  unit?: number | null;
  appVersion?: string | null;
  /** Decoded PNG bytes, or null when the capture was skipped or unavailable. */
  image: Buffer | null;
  transcript?: ReportTurn[] | null;
  /** Injected so the filename and `at` are deterministic in tests. */
  now?: Date;
  id?: string;
}

/**
 * Write a report. The JSON is always written; the PNG only when there are bytes.
 *
 * Requires `whatIsWrong`. The client disables Save while it is empty, so a server-side rejection is a
 * backstop for a programmer error rather than a path a learner can reach (see the Group 1 error-copy work:
 * the client must not offer an action guaranteed to fail).
 */
export function saveReport(input: SaveInput, env: NodeJS.ProcessEnv = process.env): SaveResult {
  const whatIsWrong = redactPaths(input.whatIsWrong ?? "").trim();
  if (!whatIsWrong) return { ok: false, error: "a description is required" };

  if (input.image && input.image.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `that capture is ${(input.image.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    };
  }

  const at = input.now ?? new Date();
  const id = input.id ?? shortId();
  const stem = reportStem(at, id);
  const dir = reportsRoot(env);

  try {
    mkdirSync(dir, { recursive: true });
    const report: Report = {
      id: stem,
      at: at.toISOString(),
      whatIsWrong,
      expected: redactPaths(input.expected ?? "").trim(),
      route: input.route,
      course: input.course ?? null,
      unit: input.unit ?? null,
      appVersion: input.appVersion ?? null,
      hasImage: Boolean(input.image),
    };
    // Omitted entirely when not attached, so "did they include it" is answerable without a null check.
    if (input.transcript && input.transcript.length > 0) report.transcript = input.transcript;

    writeFileSync(join(dir, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (input.image) writeFileSync(join(dir, `${stem}.png`), input.image);

    const { transcript: _drop, ...summary } = report;
    return { ok: true, report: summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Delete BOTH files, so no orphan remains. Returns whether anything was removed. */
export function deleteReport(stem: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) return false;
  const dir = reportsRoot(env);
  let removed = false;
  for (const ext of [".json", ".png"]) {
    const file = join(dir, `${stem}${ext}`);
    if (!existsSync(file)) continue;
    rmSync(file, { force: true });
    removed = true;
  }
  return removed;
}
