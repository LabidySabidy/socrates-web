/**
 * check-test-coverage.mjs — every test file on disk must be run by the suite.
 *
 * THE FAILURE THIS PREVENTS. A test runner configured with a hand-maintained file list fails SILENTLY when
 * the list goes stale: the run is green, the count looks plausible, and the file nobody named is simply
 * never executed. A glob has the same failure in a different shape — a `src` glob that matches
 * nothing reports success for zero tests.
 *
 * Both shapes were live in this repo:
 *   - `web/package.json` ran `node --test src/ui.test.ts`, a hardcoded name, so a new client test file was
 *     silently excluded until the list was replaced with a glob.
 *   - the root `package.json` still names its files by hand, and `web/src/*.test.ts` is not among them; those
 *     files ran only because the command happens to chain the client suite.
 *
 * `run-extension-tests.mjs` in the harness repo refuses in this situation. This is the app's equivalent:
 * it is deliberately a SEPARATE check from running the tests, so that "the suite passed" and "the suite ran
 * everything" are two independent facts. A runner cannot verify its own completeness.
 *
 * Usage: `node check-test-coverage.mjs` (also wired into `npm test`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Directories never worth descending into. */
const SKIP = new Set(["node_modules", "dist", ".git", ".agent", "coverage"]);

/** Every `*.test.ts` under `dir`, relative to ROOT, posix-separated. */
function findTests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      findTests(join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      out.push(relative(ROOT, join(dir, entry.name)).split("\\").join("/"));
    }
  }
  return out;
}

const problems = [];

// --- 1. the root command must cover every root-level test file -----------------
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const rootCmd = rootPkg.scripts?.test ?? "";

/**
 * A file is "covered" by the root command if the command names it, or if the command delegates to the
 * client suite for anything under `web/`. That delegation is legitimate — but it has to be EXPLICIT, which
 * is what this records: the client suite is globbed, so a new `web/src/*.test.ts` is covered by the glob
 * rather than by being enumerated here.
 */
const rootTests = findTests(ROOT).filter((f) => !f.startsWith("web/"));
for (const file of rootTests) {
  if (!rootCmd.includes(file)) {
    problems.push(
      `NOT RUN: ${file} exists but the root "test" script does not name it, so it would never execute.`,
    );
  }
}

/**
 * Anything under `web/` must be covered by the client script. That is stated explicitly because the root
 * script is allowed to delegate: it runs the server suites, then `npm --prefix web test`, and the client
 * script owns its own files. What must NOT happen is a `web/` test file that neither script reaches.
 */
const webTests = findTests(ROOT).filter((f) => f.startsWith("web/"));
const delegatesToClient = /npm\s+--prefix\s+web\s+test/.test(rootCmd);
if (webTests.length > 0 && !delegatesToClient && !webTests.every((f) => rootCmd.includes(f))) {
  problems.push(
    `NOT RUN: ${webTests.length} client test file(s) exist but the root script neither names them nor delegates to the client suite.`,
  );
}

// --- 2. the client command must be a glob, and the glob must match something ---
const clientPkg = JSON.parse(readFileSync(join(ROOT, "web", "package.json"), "utf8"));
const clientCmd = clientPkg.scripts?.test ?? "";
const clientTests = findTests(join(ROOT, "web", "src"));

if (!/\.test\.ts/.test(clientCmd)) {
  problems.push(`CLIENT: the client test script names no test files at all: ${JSON.stringify(clientCmd)}`);
} else if (!/[*?[]/.test(clientCmd)) {
  // A hand-written name is the stale-list failure waiting to happen.
  const named = clientTests.filter((f) => clientCmd.includes(f.replace("web/src/", "src/")));
  if (named.length < clientTests.length) {
    const missing = clientTests.filter((f) => !named.includes(f));
    problems.push(
      `CLIENT: the client script is not a glob and omits ${missing.length} file(s): ${missing.join(", ")}`,
    );
  }
} else if (clientTests.length === 0) {
  // The glob-matches-nothing shape: green, and it ran nothing.
  problems.push(`CLIENT: the client script globs, but no *.test.ts exists under web/src — it would pass for zero tests.`);
}

if (clientTests.length === 0) {
  problems.push("CLIENT: no client test files found at all, which cannot be right.");
}

// --- 3. report -----------------------------------------------------------------
if (problems.length > 0) {
  console.error("Test coverage REFUSED — the suite would not run everything it claims to:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nNothing was run. Fix the script or the working tree, then try again. This is GL-029 in the\n" +
      "harness lessons: a test runner with a hand-maintained file list fails silently when it goes stale.",
  );
  process.exit(1);
}

console.log(
  `Test coverage ok: ${rootTests.length} root-level file(s) named by the root script, ` +
    `${clientTests.length} client file(s) covered by the client glob` +
    (delegatesToClient ? " (root delegates to the client suite)." : "."),
);
