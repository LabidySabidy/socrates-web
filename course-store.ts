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
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

export interface StoredCourse {
  id: string;
  dir: string;
  title: string;
  concepts: number;
  /** Per-state counts over the unique concept cards, for the catalogue metric row. */
  masteryCounts: Record<string, number>;
  sessions: { count: number; lastAt: string | null };
}

/** Every course in the store, newest directory name first is not meaningful — order by title. */
export function listCourses(env: NodeJS.ProcessEnv = process.env): StoredCourse[] {
  const root = storeRoot(env);
  if (!isDir(root)) return [];

  const out: StoredCourse[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!isDir(learningDir(dir))) continue;
    let title = name;
    let concepts = 0;
    let masteryCounts: Record<string, number> = countByMastery([]);
    try {
      const data = parseLearning(dir);
      title = data.mission.destination.trim() || name;
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
  return out.sort((a, b) => a.title.localeCompare(b.title));
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

export type CreateResult = { ok: true; id: string; dir: string } | { ok: false; error: string };

/**
 * Start a course from a subject.
 *
 * The subject is the learner's own words and becomes the seeded mission destination. Nothing is
 * invented: the fields the interview will fill are marked as pending rather than guessed, so the
 * course reads honestly before the tutor has spoken to the learner.
 */
export function createCourse(subject: string, env: NodeJS.ProcessEnv = process.env): CreateResult {
  const clean = subject.trim();
  if (!clean) return { ok: false, error: "a subject is required" };

  const id = slugifySubject(clean);
  if (!id) return { ok: false, error: `that subject has no usable letters or digits: ${JSON.stringify(subject)}` };

  const dir = courseDir(id, env);
  if (existsSync(learningDir(dir))) return { ok: false, error: `a course called "${id}" already exists` };

  const mission = [
    `# Mission — ${clean}`,
    "",
    "> Started by the learner. The tutor interviews them and completes this file; the subject below is",
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
