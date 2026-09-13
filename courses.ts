/**
 * courses.ts — multi-course discovery: scan-first, registry overlay.
 *
 * Scan is the zero-config default: `COURSES_ROOT` (default: the parent of PROJECT_DIR) is
 * walked **one level deep** for `*​/.agent/learning`. A registry file
 * (`.agent/courses.json` by default) can then pin, order, label, hide, or add courses that
 * do not live under the scan root.
 *
 * Discovery never throws. A missing root, an unreadable directory, or corrupt registry JSON
 * each degrade to "fewer courses" plus a warning.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseLearning } from "./learning-parser.ts";
import { countByMastery, masteryOf, slug } from "./course-model.ts";
import { sessionIndex } from "./journal.ts";

export const REGISTRY_VERSION = 1;

export interface RegistryEntry {
  dir: string;
  label?: string;
  hidden?: boolean;
  /** Lower sorts first; entries without an order sort after ordered ones. */
  order?: number;
}

export interface Registry {
  version: number;
  /** Directory names or absolute paths to skip during the scan. */
  ignore: string[];
  courses: RegistryEntry[];
}

export interface CourseRef {
  id: string;
  dir: string;
  /** Registry label, else the mission destination, else the directory name. */
  label: string;
  title: string;
  hidden: boolean;
  order: number | null;
  concepts: number;
  /** Per-state counts over the course's unique concept cards, for the catalogue metrics. */
  masteryCounts: Record<string, number>;
  /** Session recency, parsed from SESSIONS file names — no log reads. */
  sessions: { count: number; lastAt: string | null };
  /**
   * A course must have been INITIATED: `.agent/learning/MISSION.md` exists.
   *
   * Without this, any project where the learning extension has ever run would count as a course,
   * because the extension creates the learning directory. Requiring the mission makes the
   * catalogue reflect what the user actually started, not what the tooling touched.
   * A not-initiated directory is still returned so the UI can list it and offer to act on it —
   * it is never silently dropped.
   */
  initiated: boolean;
  kind: "topic" | "codebase";
  fromScan: boolean;
  fromRegistry: boolean;
}

export interface DiscoveryResult {
  courses: CourseRef[];
  root: string | null;
  warnings: string[];
}

export const WARN = {
  noRoot: "courses-root-missing",
  rootUnreadable: (dir: string) => `courses-root-unreadable:${dir}`,
  registryInvalid: (reason: string) => `registry-invalid:${reason}`,
  registryMissingDir: (dir: string) => `registry-dir-not-a-course:${dir}`,
  duplicateId: (id: string) => `duplicate-course-id:${id}`,
} as const;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function learningDir(dir: string): string {
  return join(dir, ".agent", "learning");
}

export function isCourseDir(dir: string): boolean {
  try {
    return existsSync(learningDir(dir)) && statSync(learningDir(dir)).isDirectory();
  } catch {
    return false;
  }
}

export function registryPathFor(projectDir: string): string {
  return join(projectDir, ".agent", "courses.json");
}

/** Default scan root: the parent of the default course, per the decided behaviour. */
export function defaultCoursesRoot(projectDir: string): string {
  return dirname(resolve(projectDir));
}

function normalise(dir: string): string {
  return resolve(dir).replace(/[\\/]+$/, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function emptyRegistry(): Registry {
  return { version: REGISTRY_VERSION, ignore: [], courses: [] };
}

/** Tolerant load: a corrupt or absent registry yields an empty one plus a warning. */
export function loadRegistry(path: string): { registry: Registry; warnings: string[] } {
  if (!existsSync(path)) return { registry: emptyRegistry(), warnings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      registry: emptyRegistry(),
      warnings: [WARN.registryInvalid(err instanceof Error ? err.message : "unparseable")],
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { registry: emptyRegistry(), warnings: [WARN.registryInvalid("not an object")] };
  }
  const raw = parsed as Record<string, unknown>;
  const courses: RegistryEntry[] = Array.isArray(raw.courses)
    ? raw.courses
        .map((c) => c as Record<string, unknown>)
        .filter((c) => typeof c?.dir === "string")
        .map((c) => ({
          dir: String(c.dir),
          label: typeof c.label === "string" ? c.label : undefined,
          hidden: c.hidden === true,
          order: typeof c.order === "number" && Number.isFinite(c.order) ? c.order : undefined,
        }))
    : [];
  const ignore = Array.isArray(raw.ignore) ? raw.ignore.filter((i): i is string => typeof i === "string") : [];
  return { registry: { version: REGISTRY_VERSION, ignore, courses }, warnings: [] };
}

export function saveRegistry(path: string, registry: Registry): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ version: REGISTRY_VERSION, ignore: registry.ignore, courses: registry.courses }, null, 2) + "\n",
    "utf8",
  );
}

function isIgnored(dir: string, registry: Registry): boolean {
  const abs = normalise(dir);
  const name = basename(dir).toLowerCase();
  return registry.ignore.some((i) => {
    const needle = i.trim().toLowerCase();
    return needle === name || normalise(i) === abs;
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function describe(dir: string): {
  title: string;
  concepts: number;
  masteryCounts: Record<string, number>;
  sessions: { count: number; lastAt: string | null };
  initiated: boolean;
  kind: CourseRef["kind"];
} {
  const sessions = sessionIndex(dir);
  try {
    const data = parseLearning(dir);
    // MISSION.md is the marker of intent. SCHEMA.md alone is not a course: the learning
    // extension writes it (and the log) wherever a session has run.
    const initiated = data.present.includes("MISSION.md");
    const manifestPath = join(learningDir(dir), "COURSE.md");
    const kind = existsSync(manifestPath) && /^kind:\s*codebase\s*$/m.test(readFileSync(manifestPath, "utf8"))
      ? "codebase"
      : "topic";
    // Unique by slug so the catalogue agrees with the unit count the course page renders.
    const seen = new Map<string, string>();
    for (const c of data.schema.concepts) {
      if (!seen.has(slug(c.name))) seen.set(slug(c.name), c.badge);
    }
    const masteryCounts = countByMastery([...seen.values()].map((badge) => masteryOf(badge)));
    return {
      title: data.mission.destination.trim() || basename(dir),
      concepts: seen.size,
      masteryCounts,
      sessions,
      initiated,
      kind,
    };
  } catch {
    return { title: basename(dir), concepts: 0, masteryCounts: {}, sessions, initiated: false, kind: "topic" };
  }
}

/**
 * Discover courses. Precedence of metadata: registry entry > mission destination > dir name.
 * A registry `hidden: true` removes a course from the catalogue without touching disk.
 */
export function discoverCourses(opts: {
  root?: string | null;
  projectDir?: string | null;
  registryPath?: string;
}): DiscoveryResult {
  const warnings: string[] = [];
  const root = opts.root ?? (opts.projectDir ? defaultCoursesRoot(opts.projectDir) : null);
  const registryPath =
    opts.registryPath ?? (opts.projectDir ? registryPathFor(opts.projectDir) : ".agent/courses.json");

  const { registry, warnings: regWarn } = loadRegistry(registryPath);
  warnings.push(...regWarn);

  // --- scan, one level deep --------------------------------------------------
  const found: { dir: string; fromScan: boolean }[] = [];
  if (opts.projectDir && isCourseDir(opts.projectDir)) {
    found.push({ dir: resolve(opts.projectDir), fromScan: true });
  }
  if (root) {
    if (!existsSync(root)) {
      warnings.push(WARN.noRoot);
    } else {
      let entries: string[] = [];
      try {
        entries = readdirSync(root).sort();
      } catch {
        warnings.push(WARN.rootUnreadable(root));
      }
      for (const name of entries) {
        const candidate = join(root, name);
        try {
          if (!statSync(candidate).isDirectory()) continue;
        } catch {
          continue; // unreadable entry: skip, never fail the whole scan
        }
        if (!isCourseDir(candidate)) continue;
        if (isIgnored(candidate, registry)) continue;
        found.push({ dir: resolve(candidate), fromScan: true });
      }
    }
  }

  // --- registry overlay ------------------------------------------------------
  const byDir = new Map<string, { dir: string; fromScan: boolean; fromRegistry: boolean }>();
  for (const f of found) {
    byDir.set(normalise(f.dir), { ...f, fromRegistry: false });
  }
  for (const entry of registry.courses) {
    const abs = resolve(entry.dir);
    if (!isCourseDir(abs)) {
      warnings.push(WARN.registryMissingDir(entry.dir));
      continue;
    }
    const key = normalise(abs);
    const existing = byDir.get(key);
    if (existing) existing.fromRegistry = true;
    else byDir.set(key, { dir: abs, fromScan: false, fromRegistry: true });
  }

  // --- build refs, disambiguating ids ---------------------------------------
  const used = new Map<string, number>();
  const courses: CourseRef[] = [];
  for (const { dir, fromScan, fromRegistry } of byDir.values()) {
    const entry = registry.courses.find((c) => normalise(c.dir) === normalise(dir));
    let id = basename(dir);
    const n = (used.get(id.toLowerCase()) ?? 0) + 1;
    used.set(id.toLowerCase(), n);
    if (n > 1) {
      warnings.push(WARN.duplicateId(id));
      id = `${id}-${n}`;
    }
    const details = describe(dir);
    courses.push({
      id,
      dir,
      label: entry?.label ?? details.title,
      title: details.title,
      hidden: entry?.hidden === true,
      order: entry?.order ?? null,
      concepts: details.concepts,
      masteryCounts: details.masteryCounts,
      sessions: details.sessions,
      initiated: details.initiated,
      kind: details.kind,
      fromScan,
      fromRegistry,
    });
  }

  // pinned order first, then alphabetical for stability
  courses.sort((a, b) => {
    if (a.order !== null && b.order !== null) return a.order - b.order;
    if (a.order !== null) return -1;
    if (b.order !== null) return 1;
    return a.label.localeCompare(b.label);
  });

  return { courses, root: root ?? null, warnings };
}

/**
 * Author `MISSION.md` — the marker that makes a directory a course.
 *
 * This is the UI path over behaviour that already exists: the scaffold skill writes the same file
 * from the same template shape. Only the destination is required, because that is the field the
 * derivation reads for the course title; the rest can be enriched later by the scaffold skill.
 *
 * Never overwrites an existing mission — a course that has been started is not restartable.
 */
export function startCourse(
  dir: string,
  mission: { destination: string; artifact?: string; drivingProject?: string },
): { ok: boolean; error?: string } {
  const abs = resolve(dir);
  if (!isCourseDir(abs)) return { ok: false, error: `not a learning directory: ${dir}` };
  if (existsSync(join(learningDir(abs), "MISSION.md"))) {
    return { ok: false, error: "already initiated: MISSION.md exists" };
  }
  const destination = mission.destination.trim();
  if (!destination) return { ok: false, error: "destination required" };

  const body = [
    `# Mission — ${basename(abs)}`,
    "",
    "> Grounds every lesson in a real, personal reason. Written by the app from your own words; the",
    "> scaffold skill can enrich the rest of the heading, baseline and commitment sections.",
    "",
    "## Destination",
    "",
    `- **I will be able to:** ${destination}`,
    `- **Proof-of-skill artifact:** ${mission.artifact?.trim() || "<fill in later>"}`,
    `- **Driving project / pain:** ${mission.drivingProject?.trim() || "<fill in later>"}`,
    "",
  ].join(String.fromCharCode(10));

  try {
    mkdirSync(learningDir(abs), { recursive: true });
    writeFileSync(join(learningDir(abs), "MISSION.md"), body, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Courses a catalogue should show: initiated and not hidden. */
export function catalogueCourses(result: DiscoveryResult): CourseRef[] {
  return result.courses.filter((c) => c.initiated && !c.hidden);
}

/** Directories that look like courses but were never initiated — surfaced, never dropped. */
export function uninitiatedCourses(result: DiscoveryResult): CourseRef[] {
  return result.courses.filter((c) => !c.initiated);
}

/** Everything a catalogue would hide, for a management view. */
export function visibleCourses(result: DiscoveryResult): CourseRef[] {
  return result.courses.filter((c) => !c.hidden);
}

export function findCourse(result: DiscoveryResult, id: string): CourseRef | null {
  const needle = id.toLowerCase();
  return result.courses.find((c) => c.id.toLowerCase() === needle) ?? null;
}

// ---------------------------------------------------------------------------
// Register / unregister (POST /api/courses)
// ---------------------------------------------------------------------------

export function registerCourse(
  registryPath: string,
  dir: string,
  opts: { label?: string; order?: number } = {},
): { ok: boolean; error?: string } {
  const abs = resolve(dir);
  if (!isCourseDir(abs)) {
    return { ok: false, error: `not a course directory (no .agent/learning): ${dir}` };
  }
  const { registry } = loadRegistry(registryPath);
  const existing = registry.courses.find((c) => normalise(c.dir) === normalise(abs));
  if (existing) {
    if (opts.label !== undefined) existing.label = opts.label;
    if (opts.order !== undefined) existing.order = opts.order;
    existing.hidden = false;
  } else {
    registry.courses.push({ dir: abs, label: opts.label, order: opts.order, hidden: false });
  }
  saveRegistry(registryPath, registry);
  return { ok: true };
}

/** Unregister touches the registry only — the course stays on disk, untouched. */
export function unregisterCourse(
  registryPath: string,
  dir: string,
): { ok: boolean; error?: string } {
  const abs = resolve(dir);
  const { registry } = loadRegistry(registryPath);
  const before = registry.courses.length;
  registry.courses = registry.courses.filter((c) => normalise(c.dir) !== normalise(abs));
  if (registry.courses.length === before) {
    // not registered: hide it via the ignore list so a scanned course can still be removed
    if (!isIgnored(abs, registry)) {
      registry.ignore.push(basename(abs));
      saveRegistry(registryPath, registry);
      return { ok: true };
    }
    return { ok: false, error: "course is neither registered nor visible" };
  }
  saveRegistry(registryPath, registry);
  return { ok: true };
}

export function setHidden(registryPath: string, dir: string, hidden: boolean): { ok: boolean; error?: string } {
  const abs = resolve(dir);
  if (!isCourseDir(abs)) return { ok: false, error: `not a course directory: ${dir}` };
  const { registry } = loadRegistry(registryPath);
  const existing = registry.courses.find((c) => normalise(c.dir) === normalise(abs));
  if (existing) existing.hidden = hidden;
  else registry.courses.push({ dir: abs, hidden });
  saveRegistry(registryPath, registry);
  return { ok: true };
}

export const _internal = { normalise, isIgnored, sep };
