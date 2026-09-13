# Progress

> Rolling session summaries, newest first.





## 2026-09-13 11:16 — **Changed:** nothing (design call + reply prompt)
**Changed:** nothing (design call + reply prompt).
**Verified:** the severity source is tutor-emitted to stay consistent with the project's no-invented-data rule; the schema change is flagged as shared-format (extension + parser must land together).
**Next:** merge PR #3, paste this, then P1 begins — at which point I'd want to see the updated `SCHEMA.md` table spec and the derivation rules before code.
## 2026-09-13 10:23 — **Changed:** `~/.pi` → `07656d9` pushed, PR #3 un-drafted (`gh pr ready`); `sche...
**Changed:** `~/.pi` → `07656d9` pushed, PR #3 un-drafted (`gh pr ready`); `schema.ts` (+duplicate warning), `signal.ts` (+`countUserPrompts`), `index.ts` (`turn_end` handler removed, turns from user prompts), 2 new tests (30 total); `socrates-web/docs/EVENT-SCHEMA.md` (new); global `LESSONS.md` (+GL-018); project `LESSONS.md` (GL-018 pointer, schema-doc pointer); `PROGRESS.md` (P0 complete).
**Verified:** `node --test` → 30 pass / 0 fail; fresh `pi -p` read-back showing `turns: 1` and the du...
## 2026-09-13 10:20 — **Changed:** nothing (generated a reply prompt)
**Changed:** nothing (generated a reply prompt).
**Verified:** the four directives map 1:1 to the review findings; T-009 status and the no-merge rule are consistent with the standing directive.
**Next:** paste it, then P0 closes and P1 (content model + API surface) begins — that's where I'd want to see the derivation rules and `docs/CONTENT-MODEL.md` before code.
## 2026-09-13 10:10 — **Changed:** nothing (generated a reply prompt)
**Changed:** nothing (generated a reply prompt).
**Verified:** the four directives map 1:1 to the review findings; T-009 status and the no-merge rule are consistent with the standing directive.
**Next:** paste it, then P0 closes and P1 (content model + API surface) begins — that's where I'd want to see the derivation rules and `docs/CONTENT-MODEL.md` before code.
## 2026-09-13 02:26 — P0 mid-flight: pure learning modules landed on a branch, nothing verified end to end
Handoff analysis complete (`docs/HANDOFF-ANALYSIS.md`, 6 reference screenshots) and all 7 Platform decisions +
2 architecture decisions recorded in `DECISIONS.md`; `PLAN.md` rewritten to P0–P6 and `TASKS.md` to T-001–T-031.
P0 (telemetry durability / DEF-001) is a **separate workstream in the `pi-agent-harness` repo** — T-001 landed as
commit `19afbcc` on branch `p0-telemetry-durability` (PR #3, **draft, unmerged**): pure `telemetry.ts`,
`events.ts`, `schema.ts` + 17 passing tests, inert because pi resolves `extensions/<dir>/` only via
`index.ts`/`index.js`/manifest (verified empirically against the real loader).
**Verified:** 17/17 tests pass; loader fixture proves `learning/*` resolves to nothing without `index.ts`.
**Next:** **P0 is complete and verified.** T-002–T-008 landed in `e9000af`; the T-009 read-back ran in a
throwaway `learning-demo` copy via fresh `pi -p` processes and found a real bug (`telemetry_missing` firing
per agent turn rather than per run → fixed in `a577886`); review directives 1–4 landed in `07656d9`. PR #3 is
**ready for review** (4 commits, +1665/−368). Next workstream is **P1 — content model + API surface** (T-010–T-016).









## 2026-09-13 02:44 — **Changed:** `~/.pi` branch `p0-telemetry-durability` → `a577886` pushed (3 comm...
**Changed:** `~/.pi` branch `p0-telemetry-durability` → `a577886` pushed (3 commits, 10 files, +1599/−368, PR #3 still draft); `socrates-web/TASKS.md` (T-009 done + known limitation).
**Verified:** all raw output above — one fresh `pi -p` process per phase, cwd = throwaway `learning-demo` copy; source SCHEMA.md md5 `c8e42119f4d3fb5532b678ec19c8dc30` unchanged; `node --test` → 28 pass / 0 fail; `gh pr view 3 --json` → `state OPEN, isDraft true`.
**Next:** your event-schema + projection review ...
## 2026-09-13 02:40 — **Changed:** nothing (read-back guidance)
**Changed:** nothing (read-back guidance).
**Verified:** the fixture-mutation risk is real — the read-back writes badges/SM-2/MIS into `SCHEMA.md`, which is the same file the derivation model reads.
**Next:** run the read-back from a `learning-demo` copy and return the raw artifacts.
## 2026-09-13 02:11 — **Changed:** `DECISIONS.md` — added 2 ADR entries (event-sourced 3-layer learnin...
**Changed:** `DECISIONS.md` — added 2 ADR entries (event-sourced 3-layer learning state, per course; course.kind topic|codebase).
**Verified:** `tail -3 DECISIONS.md` before edit to anchor exact text; edit applied (1 block replaced); extension API facts previously read from `dist/core/extensions/types.d.ts` (`session_start`/`agent_end`/`session_shutdown`, `ctx.sessionManager`, tool registration).
**Next:** confirm the 3 defaults (or override), then I write `PLAN.md` starting at P0.
## 2026-09-13 02:11 — **Changed:** nothing (revised a prompt)
**Changed:** nothing (revised a prompt).
**Verified:** handoff folder contents listed (`README.md`, 2 `.dc.html`, `support.js`); README's own "design reference, not production code" rule confirmed and reflected.
**Next:** paste it with the handoff path. The agent's first two outputs — the separation note and the content-model spike — are what I'd review before it writes any real code.
## 2026-09-13 02:01 — **Changed:** nothing (revised a prompt)
**Changed:** nothing (revised a prompt).
**Verified:** handoff folder contents listed (`README.md`, 2 `.dc.html`, `support.js`); README's own "design reference, not production code" rule confirmed and reflected.
**Next:** paste it with the handoff path. The agent's first two outputs — the separation note and the content-model spike — are what I'd review before it writes any real code.
## 2026-09-13 01:46 — **Changed:** nothing (generated a fresh prompt)
**Changed:** nothing (generated a fresh prompt).
**Verified:** every requirement from the approved plan is represented; medium-specific constraints (no build, canvas globe, hash routing, mock stream) added for the Claude artifact environment.
**Next:** paste it. When it returns, send me the artifact + its summary and I'll run the review pass.
## 2026-09-13 00:40 — **Changed:**
- Pushed `f634776` to `origin/main` (bundled-pi commit + docs + loc...
**Changed:**
- Pushed `f634776` to `origin/main` (bundled-pi commit + docs + lockfile).
- Started socrates-web as a detached process (PID 28772) on **http://localhost:3850**, `PROJECT_DIR=F:\Development\DriftScout`.

**Verified:**
- `/health` → `ok`
- `/api/learning` → 3 files present, 5 concepts, real mission text
- `/` → `200 text/html`
- Server process alive (`HasExited=False`), logs clean, stderr empty.

**Next:** Open http://localhost:3850 in your browser. To stop it: `Stop-Process -Id 2...
## 2026-09-12 16:24 — **Changed:**
- `package.json` + `package-lock.json` — added `@earendil-works/pi-...
**Changed:**
- `package.json` + `package-lock.json` — added `@earendil-works/pi-coding-agent@^0.85.1` (published, bin `pi → dist/bundle/cli.js`).
- `process-bridge.ts` — default spawn is now `node <bundled-pi-cli> --mode rpc`, resolved via `import.meta.resolve` (needed because the package is ESM-only — `require.resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`). Dropped the Windows `.cmd` shell wrapper; `PI_BIN`/`PI_ARGS` retained as test escape hatch.
- `PLAN.md` / `.gitignore` — removed stale...
## 2026-09-12 16:08 — Understood — two corrections accepted and one real gap surfaced
Understood — two corrections accepted and one real gap surfaced.

**Corrections locked in:**
- `PROJECT_DIR` is required, not optional. Points at `F:\Development\DriftScout` (the dir holding `.agent\learning\`). Without it, cwd = socrates-web → `/api/learning` returns an empty structure (no error, but zero concepts/mission).
- Port is 3850. The 3847 in the old log was the pre-rename "study-dashboard" build.

**The pi-bundling point is the real issue.** Current state:

- `process-bridge.ts` sp...
