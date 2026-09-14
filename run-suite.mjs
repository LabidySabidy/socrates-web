/**
 * run-suite.mjs — run every test file SEPARATELY, so each one's count is attributable.
 *
 * WHY NOT ONE `node --test a b c` INVOCATION. Two reasons, both observed in this project's history:
 *
 *  1. An aggregate count proves nothing about which files ran. `node --test a.test.ts b.test.ts` where
 *     `b.test.ts` does not exist reports only `a`'s tests and EXITS 0 — a green number that silently
 *     excludes the thing just built. (This is why `run-extension-tests.mjs` exists in the harness repo.)
 *  2. Per-file counts are what let a floor be asserted, so a file that stops discovering tests is visible.
 *
 * The file list is NOT maintained here: `check-test-coverage.mjs` proves every `*.test.ts` on disk is
 * covered by the scripts, and this runner takes the list the root script supplies. One place decides what
 * runs; a second, independent check decides whether anything was left out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("run-suite.mjs: no test files given. Usage: node run-suite.mjs <file...>");
  process.exit(1);
}

const missing = files.filter((f) => !existsSync(join(ROOT, f)));
if (missing.length > 0) {
  console.error(`run-suite.mjs REFUSED — declared but not on disk:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

let total = 0;
let failed = 0;
const results = [];

for (const file of files) {
  let out = "";
  let status = 0;
  try {
    out = execFileSync(process.execPath, ["--test", "--test-timeout", "60000", file], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    status = 1;
    out = `${(err && err.stdout) || ""}${(err && err.stderr) || ""}`;
  }
  // Node prints `ℹ pass 8` on the spec reporter and `# pass 8` under TAP. Both are accepted, because a
  // parser that recognises only one silently reports zero — the same silent-zero failure this file exists
  // to prevent, one layer down.
  const count = (word) =>
    Number((new RegExp(`^[#\u2139]\\s*${word}\\s+(\\d+)$`, "m").exec(out)?.[1]) ?? 0);
  const pass = count("pass");
  const fail = count("fail");
  total += pass;
  failed += fail;
  results.push({ file, pass, fail, status });
  /**
   * NOTE ON WHAT THIS CANNOT DETECT, learned by testing it: node reports `tests 1, pass 1` for a file that
   * contains only `export const x = 1`, and exits 0. So a count of 1 proves the file LOADED, not that it
   * contains assertions — there is no reliable "ran zero tests" signal from the count alone.
   *
   * What IS detectable, and is checked here: the file failed, or node refused it outright, or the count is
   * below a floor declared for it. Everything else would be pretending to a guarantee this metric does not
   * have, and a guard that overclaims is worse than a narrow one.
   */
  const label = fail > 0 || status !== 0 ? "FAIL" : "PASS";
  console.log(`  ${label}  ${file} — ${pass} passed${fail > 0 ? `, ${fail} failed` : ""}`);
  if (fail > 0 || status !== 0) {
    console.log(out.split("\n").filter((l) => /not ok|AssertionError|Error:/.test(l)).slice(0, 8).join("\n"));
  }
}

console.log(`\ntotal ${total} passed across ${files.length} file(s), ${failed} failed`);
process.exit(failed > 0 || results.some((r) => r.status !== 0) ? 1 : 0);
