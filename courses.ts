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
import { slug } from "./course-model.ts";

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

function describe(dir: string): { title: string; concepts: number; kind: CourseRef["kind"] } {
  try {
    const data = parseLearning(dir);
    const manifestPath = join(learningDir(dir), "COURSE.md");
    const kind = existsSync(manifestPath) && /^kind:\s*codebase\s*$/m.test(readFileSync(manifestPath, "utf8"))
      ? "codebase"
      : "topic";
    return {
      title: data.mission.destination.trim() || basename(dir),
      // Counted uniquely, matching the derivation: duplicate card names collapse to one unit,
      // so a card count here would disagree with the unit count the course page renders.
      concepts: new Set(data.schema.concepts.map((c) => slug(c.name))).size,
      kind,
    };
  } catch {
    return { title: basename(dir), concepts: 0, kind: "topic" };
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

/** Courses a catalogue should show: everything not hidden. */
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
