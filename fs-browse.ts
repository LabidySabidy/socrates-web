/**
 * fs-browse.ts — a server-side folder browser.
 *
 * WHY THIS EXISTS. A page cannot hand this server a real directory path: the File System Access API
 * deliberately does not expose an absolute path, and `<input type="file" webkitdirectory>` only
 * uploads file objects. A local app that must act on a path it can read therefore has to browse the
 * filesystem on the server and send back paths, which is what every local tool does.
 *
 * EXPOSURE, stated plainly: this lists DIRECTORY NAMES under a caller-supplied path. That is a real
 * widening of the app's surface, so it is paired with two deliberate limits:
 *
 *   - the server binds to loopback by default, so the listing is reachable only from this machine;
 *   - this module lists directories ONLY. It never returns file names and never reads file contents,
 *     so it cannot be used to read anything — only to choose a folder.
 *
 * Directories that are courses are flagged, because choosing one is the point.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface DirEntry {
  name: string;
  path: string;
  /** Has `.agent/learning/` — the marker that makes registration possible. */
  isCourse: boolean;
  /** Has `MISSION.md` — the marker of a course the user actually started. */
  initiated: boolean;
}

export interface BrowseResult {
  /** The directory being listed, or null when showing the roots. */
  path: string | null;
  parent: string | null;
  /** Every entry is a directory. Empty at a root level in the UI's sense. */
  entries: DirEntry[];
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Existing drive roots on Windows, `/` elsewhere. */
export function roots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return ["/"];
  const found: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const drive = `${String.fromCharCode(c)}:\\`;
    if (existsSync(drive)) found.push(drive);
  }
  return found;
}

/** The containing directory, or null when there is nowhere above (a drive root, or `/`). */
export function parentOf(path: string): string | null {
  const resolved = resolve(path);
  const parent = dirname(resolved);
  return parent === resolved ? null : parent;
}

function describe(path: string): DirEntry {
  const learning = join(path, ".agent", "learning");
  return {
    name: basename(path) || path,
    path,
    isCourse: isDir(learning),
    initiated: existsSync(join(learning, "MISSION.md")),
  };
}

/**
 * List a directory's subdirectories. `null` lists the roots, which is where a picker starts.
 * Throws with a readable message when the path is not a directory, so the route can say why.
 */
export function browse(path: string | null): BrowseResult {
  if (path === null) {
    return {
      path: null,
      parent: null,
      entries: roots().map((drive) => ({ name: drive, path: drive, isCourse: false, initiated: false })),
    };
  }

  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`no such directory: ${path}`);
  if (!isDir(resolved)) throw new Error(`not a directory: ${path}`);

  const entries: DirEntry[] = [];
  for (const name of readdirSync(resolved)) {
    const child = join(resolved, name);
    // Directories only: a file name is information this endpoint has no reason to return.
    if (!isDir(child)) continue;
    entries.push(describe(child));
  }

  // Courses first — choosing one is the point of the picker — then alphabetical.
  entries.sort((a, b) => Number(b.isCourse) - Number(a.isCourse) || a.name.localeCompare(b.name));

  return { path: resolved, parent: parentOf(resolved), entries };
}
