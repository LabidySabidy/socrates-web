/**
 * course-store.ts — where courses live, and how one is started.
 *
 * ONE STORE: `~/.socrates/courses/<slug>/.agent/learning/`. A course is a SUBJECT the learner
 * articulates, not a folder they point at, so there is no scan root, no registry and no filesystem
 * browsing. The pi session runs with `cwd` set to the course directory, so the learning extensions
 * write telemetry in place with no change to them.
 *
 * Starting a course creates the directory and seeds `MISSION.md` with the subject in the learner's own
 * words — the course is then real and titled immediately — and the UI dispatches
 * `/skill:scaffold-learning`, which interviews the learner and fills in the rest.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseLearning } from "./learning-parser.ts";
import { countByMastery, masteryOf, slug } from "./course-model.ts";

/** `SOCRATES_HOME` overrides the store, so tests never touch a real one. */
export function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.SOCRATES_HOME ? resolve(env.SOCRATES_HOME) : join(homedir(), ".socrates", "courses");
}

export function learningDir(courseDirPath: string): string {
  return join(courseDirPath, ".agent", "learning");
}

export function courseDir(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), id);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A subject reduced to a safe directory name. Exported because the id a caller sees IS this slug, and
 * tests pin that two subjects which differ only in punctuation do not collide.
 */
export function slugifySubject(subject: string): string {
  return subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/**
 * The shape the API and the UI consume. One store means no scan and no registry, so this is just a
 * course plus its derived numbers.
 */
export interface CourseRef extends StoredCourse {
  label: string;
  fromStore: true;
}

export interface StoredCourse {
  id: string;
  dir: string;
  title: string;
  concepts: number;
  /** Per-state counts over the unique concept cards, for the catalogue metric row. */
  masteryCounts: Record<string, number>;
  sessions: { count: number; lastAt: string | null };
}

/**
 * `listCourses` also reports which courses have a rename that cannot be applied.
 *
 * A blocked rename is visible WITHOUT touching the filesystem: the H1 wants slug X, and a directory named X
 * already exists. Everything needed is already in hand — the H1 is read for the title, and the directory
 * listing is what the loop iterates — so this is a Set lookup, not a move. That is why the catalogue does
 * NOT call `reconcile`: doing so would attempt N filesystem renames on every catalogue load, and a read
 * must not perform N mutations.
 */
export interface CourseList {
  courses: StoredCourse[];
  /** Courses whose H1 names a directory that already exists, so the move cannot happen. */
  blockedRenames: { id: string; wanted: string; human: string }[];
}

/** Every course in the store, newest directory name first is not meaningful — order by title. */
export function listCourses(env: NodeJS.ProcessEnv = process.env): StoredCourse[] {
  return listCoursesWithRenames(env).courses;
}

/** The full listing, including which renames are blocked. */
export function listCoursesWithRenames(env: NodeJS.ProcessEnv = process.env): CourseList {
  const root = storeRoot(env);
  if (!isDir(root)) return { courses: [], blockedRenames: [] };

  const names = readdirSync(root).filter((n) => isDir(learningDir(join(root, n))));
  const taken = new Set(names);
  const blockedRenames: CourseList["blockedRenames"] = [];
  const out: StoredCourse[] = [];
  for (const name of names) {
    const dir = join(root, name);
    let title = name;
    let concepts = 0;
    let masteryCounts: Record<string, number> = countByMastery([]);
    try {
      const data = parseLearning(dir);
      const human = data.mission.title.trim() || name;
      // The move this H1 asks for cannot happen, because another course already owns that directory. The
      // label then derives from the DIRECTORY, so the catalogue cannot show a name the URL cannot reach.
      const wanted = slugifySubject(human);
      if (wanted && wanted !== name && taken.has(wanted)) {
        blockedRenames.push({ id: name, wanted, human });
        title = name;
      } else {
        title = human;
      }
      // Unique by slug, so the catalogue agrees with the unit count the course page renders.
      const seen = new Map<string, string>();
      for (const c of data.schema.concepts) if (!seen.has(slug(c.name))) seen.set(slug(c.name), c.badge);
      concepts = seen.size;
      masteryCounts = countByMastery([...seen.values()].map((badge) => masteryOf(badge)));
    } catch {
      /* an unreadable course still lists, by its directory name */
    }
    out.push({ id: name, dir, title, concepts, masteryCounts, sessions: sessionIndex(dir) });
  }
  return { courses: out.sort((a, b) => a.title.localeCompare(b.title)), blockedRenames };
}

/** Session recency from the SESSIONS file names — no log reads, same rule as the discovery stack had. */
function sessionIndex(dir: string): { count: number; lastAt: string | null } {
  const sessions = join(learningDir(dir), "SESSIONS");
  if (!isDir(sessions)) return { count: 0, lastAt: null };
  try {
    const dates = readdirSync(sessions)
      .map((f) => /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-[0-9a-f]{8}\.md$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => `${m[1]}T${m[2]}:${m[3]}:00.000Z`);
    return { count: dates.length, lastAt: dates.length === 0 ? null : dates.slice().sort().at(-1)! };
  } catch {
    return { count: 0, lastAt: null };
  }
}

/** Every course, in the shape the API serves. */
export function courseRefs(env: NodeJS.ProcessEnv = process.env): CourseRef[] {
  return listCourses(env).map((c) => ({ ...c, label: c.title, fromStore: true as const }));
}

/** Look up a course by id. Takes the discovery shape, which is what every caller already has. */
export function findCourse(list: { courses: CourseRef[] }, id: string): CourseRef | null {
  const needle = id.toLowerCase();
  return list.courses.find((c) => c.id.toLowerCase() === needle) ?? null;
}

export type CreateResult = { ok: true; id: string; dir: string } | { ok: false; error: string };

/**
 * Start a course from a subject.
 *
 * The subject is the learner's own words and is written to BOTH places at birth: the H1 becomes the
 * course title (and therefore the directory, the URL and the catalogue name) and the destination
 * carries the same words until the interview replaces them. They are separate from that point on —
 * the skill proposes an elegant H1, the learner can edit it, and the destination stays the goal.
 *
 * Nothing is invented: the fields the interview will fill are marked as pending rather than guessed,
 * so the course reads honestly before the tutor has spoken to the learner.
 */
export function createCourse(subject: string, env: NodeJS.ProcessEnv = process.env): CreateResult {
  const clean = subject.trim();
  if (!clean) return { ok: false, error: "a subject is required" };

  const id = slugifySubject(clean);
  if (!id) return { ok: false, error: `that subject has no usable letters or digits: ${JSON.stringify(subject)}` };

  const dir = courseDir(id, env);
  if (existsSync(learningDir(dir))) return { ok: false, error: `a course called "${id}" already exists` };

  const mission = [
    `# ${clean}`,
    "",
    "> Started by the learner. The tutor interviews them and completes this file; the title above is",
    "> the learner's own words, and the remaining fields are pending that conversation.",
    "",
    "## Destination",
    "",
    `- **I will be able to:** ${clean}`,
    "- **Proof-of-skill artifact:** <pending the interview>",
    "- **Driving project / pain:** <pending the interview>",
    "",
  ].join(String.fromCharCode(10));

  try {
    mkdirSync(learningDir(dir), { recursive: true });
    writeFileSync(join(learningDir(dir), "MISSION.md"), mission, "utf8");
    return { ok: true, id, dir };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// The name lives in ONE place, and everything else follows it
// ---------------------------------------------------------------------------

/**
 * A title long enough to read, short enough that the derivation stays predictable.
 *
 * The slug truncates at 64 characters, so a title beyond this would be given a directory name that no
 * longer matches the words the learner typed — the silent truncation this bound exists to prevent. The
 * API refuses the title and says which limit was hit rather than mangling it.
 */
export const TITLE_MAX = 80;

/** Every reason a proposed title is refused, in the order a learner would hit them. */
export function validateTitle(title: string): { ok: true; clean: string } | { ok: false; error: string } {
  const clean = title.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "a title is required" };
  if (clean.length > TITLE_MAX) {
    return {
      ok: false,
      error: `that title is ${clean.length} characters; the limit is ${TITLE_MAX} so the course name and its directory stay in step`,
    };
  }
  if (!slugifySubject(clean)) {
    return { ok: false, error: `that title has no usable letters or digits: ${JSON.stringify(title)}` };
  }
  return { ok: true, clean };
}

/**
 * Write the H1 of MISSION.md, touching nothing else.
 *
 * Surgical on purpose: the mission holds the destination, the artifact and the driving project, all of
 * which the tutor and the learner have edited together. Replacing the first ATX H1 in place — or
 * prepending one — keeps every other byte of the file exactly as it was.
 */
export function writeMissionTitle(dir: string, title: string): { ok: true } | { ok: false; error: string } {
  const file = join(learningDir(dir), "MISSION.md");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ok: false, error: "this course has no MISSION.md to title" };
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let fenced = false;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:```|~~~)/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^#\s+/.test(lines[i])) {
      lines[i] = `# ${title}`;
      replaced = true;
      break;
    }
  }
  const next = replaced ? lines.join(eol) : [`# ${title}`, "", ...lines].join(eol);
  try {
    writeFileSync(file, next, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ReconcileResult =
  | { ok: true; renamed: false; id: string; dir: string }
  | { ok: true; renamed: true; id: string; dir: string; from: string; to: string; fromDir: string }
  | { ok: false; error: string };

/**
 * Make the filesystem agree with the document.
 *
 * The H1 is the name; the directory is derived from it. Whenever those disagree — a UI rename, the
 * skill's title, or a hand-edited H1 — this is the ONE step that moves the directory, and it is the
 * only thing in the app that ever renames a course.
 *
 * The caller must have already taken the agent out of the way (`ProcessBridge.moveCourseDir`): a live
 * process's cwd cannot be renamed on Windows.
 */
export function reconcileCourse(id: string, env: NodeJS.ProcessEnv = process.env): ReconcileResult {
  const fromDir = courseDir(id, env);
  if (!isDir(learningDir(fromDir))) return { ok: false, error: `unknown course: ${id}` };

  const data = parseLearning(fromDir);
  const wanted = data.mission.title.trim();
  if (!wanted) return { ok: false, error: "this course has no title to reconcile" };

  const to = slugifySubject(wanted);
  if (!to) return { ok: false, error: `the title has no usable letters or digits: ${JSON.stringify(wanted)}` };
  if (to === id) return { ok: true, renamed: false, id, dir: fromDir };

  const toDir = courseDir(to, env);
  if (existsSync(toDir)) {
    // Never clobber. Naming the collision is what lets the learner choose a different title.
    return { ok: false, error: `a course called "${to}" already exists — pick a different title` };
  }

  try {
    mkdirSync(storeRoot(env), { recursive: true });
    renameSync(fromDir, toDir);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, renamed: true, id: to, dir: toDir, from: id, to, fromDir };
}
