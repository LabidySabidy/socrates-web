# Decisions

> ADR-lite: why we did what we did, so future-me doesn't re-litigate.

## 2026-09-12 — Bundle pi as an npm dependency (abandon zero-dependency)

**Context:** Socrates-Web drives a `pi --mode rpc` subprocess for the Socratic chat bridge. Originally `pi` was resolved from PATH, so a fresh machine without pi installed would silently lose the chat bridge. Goal: "anyone can download and get going."

**Decision:** Add `@earendil-works/pi-coding-agent` as a runtime dependency. `process-bridge.ts` resolves the bundled CLI via `import.meta.resolve` (`require.resolve` fails — the package is ESM-only with no `require` export condition) and spawns it as `node <cli> --mode rpc`. `PI_BIN`/`PI_ARGS` env remain as escape hatches (used by tests to inject a mock pi).

**Alternatives considered:**
- Document pi as a manual prerequisite + startup check — simplest, but not turnkey.
- Vendor a setup script that installs pi locally — turnkey-ish, but an extra step beyond plain `npm install`.

**Tradeoffs:** Sacrifices the zero-dependency principle (~165 packages pulled in). Accepted because turnkey distribution outweighs the aesthetic constraint; Node built-ins still handle all HTTP/parsing/watching.

## 2026-09-13 — Learning state is event-sourced, and the log is per course

**Context:** `SCHEMA.md` is explicitly mutation-in-place ("never delete cards; mutate the badge, fields, and
JSON telemetry blocks in place"). It therefore stores current mastery and **no history** — so "continue
where you left off" had nothing real to read, and the handoff had to fabricate a 40% figure. Separately, a
misconception-persistence defect (DEF-001) proved the danger of a single destructively-edited store: the
write path is fire-and-forget on a voluntary `<learning-telemetry>` block, and when a session emitted none,
nothing was written and nothing was logged. Any writer bug is permanent data loss.

**Decision:** Three layers, all flat files, per course:

| Layer | Artifact | Written by | Authority |
|---|---|---|---|
| 0 raw transcript | pi's `sessions/*.jsonl` (already exists) | pi | ground truth, never edited |
| 1 event log | `<course>/.agent/learning/events.jsonl`, append-only | extension, deterministic | one line per event, never rewritten |
| 2 projections | `SCHEMA.md` (current state), `SESSIONS/<date>-<slug>.md` (journal) | derived from layer 1 | rebuildable, disposable |

Layer 1 starts with `session_start` / `session_end` events written from `ctx.sessionManager` on the
`session_start` / `agent_end` / `session_shutdown` hooks — no model cooperation required, so a session
record always exists. Rich events (badge changes, misconception open/resolve) come from the tutor; when they
are absent while grill activity occurred, a `telemetry_missing` event is appended so the gap is recorded
rather than silent.

**Alternatives considered:**
- Minimal single layer — write `SESSIONS/<date>.md` at session end, leave `SCHEMA.md` as the only state.
  ~80% of the value, ~30% of the work; rejected because it keeps mutation-in-place risk and still cannot
  reconstruct history, and per-unit history is required by the Platform UI anyway.
- Centralised log next to pi's sessions — rejected; a course should stay self-contained and portable.

**Tradeoffs:** One extra append-only file and a derive step, in exchange for never losing learning history
to a write bug, dedupe/upsert moving to the projection layer, and a real source for the Cockpit's session
rail. Misconception history and corrections become queryable instead of overwritten.

## 2026-09-13 — A course may be topic-anchored or codebase-anchored

**Superseded** 2026-09-13 by P16 — a course is a subject, not a folder. There is no `course.kind`: a course is a subject the learner names, so no course is
anchored to a repository and no generated item is grounded in a real file. The subject is now
stated once, in `MISSION.md`, and the store is `~/.socrates/courses/<slug>/`.

**Context:** The handoff's catalogue is subject-based (Algebra, Biology), but the only real learning
missions on this machine are anchored to a codebase — `DriftScout`'s mission is "build an admin post
authorization system into DriftScout". The user explicitly wants to ask about a codebase rather than a
subject. This also resolves an open question from the handoff analysis: nothing on disk authors quizzes,
hints, or interactives, so screens D and E had no content source.

**Decision:** `course.kind` is either `topic` or `codebase`, and it selects where assessment and interactive
material is grounded. For a `codebase` course, primary sources are real repo artifacts (file paths, diffs,
migrations) and generated quizzes/interactives must cite them. Nothing is invented.

**Alternatives considered:** Treat every course as a subject and keep assessments purely generated —
rejected; it produces unverifiable content and contradicts the project's evidence rule.

**Tradeoffs:** The generator must be able to read the repo (the pi bridge already runs with `cwd` set to the
course directory, so this is available). Adds a `kind` discriminator and per-kind generation prompts.

## 2026-09-13 — Content model: derived default, optional authored override

**Context:** The handoff's IA is Course → Units → Lessons → Modules. The real content on disk is
`MISSION.md` / `PLAN.md` / `SCHEMA.md`, and spike evidence showed there is no machine-readable link from a
PLAN phase to a SCHEMA concept — prose matching recovered 2 of 5 concepts in one project and 0 of 4 in
another (which has no roadmap section at all). Deriving units from phases is guessing. Deriving units from
concept cards is exact, works in both real projects, and needs zero invented data.

**Decision:** Two-tier content model. Derive the tree by default so **any** existing `.agent/learning`
directory renders with zero new files; allow an optional `COURSE.md` manifest to override it.

Precedence: `COURSE.md` manifest **>** derived tree.

Derivation rules (documented in `docs/CONTENT-MODEL.md`):

| Level | Derived from | Rule |
|---|---|---|
| Course | the learning directory | `id` = directory name; `title` = MISSION "I will be able to"; `kind` defaults to `topic` |
| Unit | one per SCHEMA.md concept card | `title` = card heading name; mastery = the card's badge; aggregate = mean of member rings |
| Lesson | the concept card itself | definition, connections, SM-2 telemetry, misconceptions |
| Module | derived study actions per lesson | `recite` (grill), `review` (SM-2 due), `explain` (Feynman), `misconceptions` (count) |
| Course context | MISSION + PLAN | rendered as "About this course" and the mission anchor — never as units |

`COURSE.md` may declare explicit lesson groups, module order, module types, and assessment placement.
Absent a manifest, the derivation above is authoritative.

**Superseded** 2026-09-13 by P16 — a course is a subject, not a folder. The `kind` row and the manifest's `kind: codebase` are gone with the codebase kind; the
manifest override itself still stands, and a course's units are still its concept cards.

**Alternatives considered:** Manifest-only (explicit but every existing directory needs a new file, and
existing projects break) — rejected. Derive units from PLAN phases (spike-disproved) — rejected.

**Tradeoffs:** The derived tree cannot express the handoff's richer structure (lesson groups with headings,
quizzes interleaved between groups) — that requires a `COURSE.md`, which is exactly the escape hatch. The
derivation must stay small and documented so it cannot drift into heuristics.

**Downstream constraint:** `DriftScout` must render immediately with zero new files, as the derivation's
regression fixture. It is a rendering fixture, not a course to continue (its session backfill was scrapped).

## 2026-09-13 — Add-a-course: scan-first, registry overlay, API/UI path

**Superseded** 2026-09-13 by P16 — a course is a subject, not a folder. All three mechanisms are deleted outright — the scan, the registry overlay and the
register/unregister API. Adding a course is `POST /api/courses { subject }`, which creates
`~/.socrates/courses/<slug>/` and seeds `MISSION.md` for the tutor's interview.

**Context:** Today one `PROJECT_DIR` env var binds exactly one course. The handoff has a course switcher and
a catalogue but no way to add a course. Spike B proved `parseLearning(dir)` is already directory-agnostic and
that both a scan and a registry file can enumerate multiple real courses.

**Decision:** Ship all three mechanisms, scan as the zero-config default:

1. **Scan** — `COURSES_ROOT` env (default: parent directory of `PROJECT_DIR`), scanned **one level deep** for
   `*/.agent/learning` → auto-discovered courses. Honours an ignore list.
2. **Registry overlay** — `.agent/courses.json` can pin, order, label, hide, or add courses outside the scan
   root.
3. **API/UI** — `POST /api/courses` registers or unregisters a course by writing the registry, so the UI can
   offer an "Add course" form.

**Alternatives considered:** Registry-only (explicit, but zero-config is lost) — rejected. Filesystem scan
alone (no way to hide a stray repo or pin order) — rejected.

**Tradeoffs:** Scanning a large parent directory is implicit magic and touches every sibling directory; it is
bounded to one level and cheap (one `stat` per directory), and the ignore list plus the registry's `hidden`
flag are the escape hatches. Windows path handling must go through the existing helpers (GL-001).

## 2026-09-13 — Multi-course bridge: one pi process, restarted on course switch

**Context:** The bridge spawns `pi --mode rpc` with `cwd` set to the course directory. That cwd *is* which
course the tutor can read and write. Multiple courses therefore force a decision, and pi is memory-heavy
(~1GB observed).

**Superseded** 2026-09-13 by P16 — a course is a subject, not a folder. The cwd no longer comes from `PROJECT_DIR` (deleted) — it is the directory of the course
being taught, under `~/.socrates/courses/`. The decision below — one process, killed and warm-spawned on
a course switch — is unchanged and still in force.

**Decision:** Keep **one** pi process. On course switch: kill the whole process tree (`taskkill /T` on Windows,
as `kill()` already does), then warm-spawn for the new course so the first prompt is not cold.

**Alternatives considered:** One process per course, lazily spawned and kept alive — rejected on memory; n
concurrent courses would mean n resident ~1GB processes. A single process with a switched `cwd` mid-flight —
rejected; pi resolves paths and project trust against its startup cwd.

**Tradeoffs:** Per-course conversational context is lost on switch. Accepted as desirable: it keeps each
course's tutoring session clean and matches the session-journal model, where a course's history lives in its
own event log rather than in one long-lived agent context. A switch during an active turn must kill the
stream and surface it to the client instead of silently dropping tokens.

## 2026-09-13 — Retention score is derived, and labelled as an estimate

**Context:** The Cockpit mock shows "82% durable retention". Nothing in `SCHEMA.md` backs that number, and an
earlier decision rejected fabricating it. But the SM-2 fields (`repetitions`, `ease_factor`, `interval`) do
carry real signal about memory strength.

**Decision:** Derive a memory-strength estimate from the SM-2 fields and label it **"Memory strength (SM-2
estimate)"** everywhere it appears. Never call it durable retention. Keep the raw SM-2 panel (`last_tested` /
`next_review` / `interval` / `ease_factor` / `repetitions`) and the misconception tray visible alongside it,
so the estimate is always auditable against its inputs.

**Alternatives considered:** Drop the score (safest, loses the Cockpit's most legible telemetry) — rejected
once an honest label plus visible inputs were on the table.

**Tradeoffs:** A single number invites over-reading regardless of its label; the formula must be documented,
monotone in its inputs, and must render "insufficient data" rather than 0% when no reviews exist.

## 2026-09-13 — Frontend: Vite + React + TypeScript (breaks the no-build rule)

**Context:** The project shipped as Node-24-native no-build: `server.ts` serves `public/` statically and the
UI is hand-rolled vanilla DOM. The handoff requires five screens, a quiz state machine with hints, a
mastery-gate modal, toasts, a collapsible lesson rail, and two canvas interactives. This is the same class of
trade as the pi-bundling decision: a founding constraint traded for delivery.

**Decision:** Vite + React + TypeScript for the UI. The Node server stays the API. Vite builds static assets
and the Node server serves them; in development the Vite server proxies `/api` to Node. Design tokens from
the handoff become CSS custom properties (Tailwind optional, not required). Port layout, tokens, copy, and
behavior — never the mockup's inline styles or the `support.js` template runtime.

**Alternatives considered:** Stay vanilla and grow `app.js` — rejected; six views plus a quiz state machine
is past where hand-rolled DOM pays off, and the handoff explicitly says to use real components. Angular —
rejected as heavier than the task needs.

**Tradeoffs:** Introduces a build step and a dev/prod asset split, undoing the "no build step" property that
`PLAN.md` and `DECISIONS.md` previously treated as a feature. `npm test` (node:test) stays for the server; the
frontend adds `tsc --noEmit` + `vite build` to the acceptance gates per `STANDARDS.md` (TypeScript row).

## 2026-09-13 — Assessments: authored when present, pi-generated otherwise

**Context:** `find` across both real learning directories returned only `MISSION.md`, `PLAN.md`, `SCHEMA.md`
and telemetry files — no quiz items, no hints, no step solutions. The handoff's Quiz/Unit-test screens
therefore have no content source. Generating them blindly would produce unverifiable items.

**Decision:** Authored wins when present: if `COURSE.md` declares quiz / unit-test items, use them. Otherwise
generate on demand via pi under a structured-output contract (question, choices-or-answer, hints,
step-by-step solution), **validate before serving**, then cache the validated item. Derivation/generation is
the default so authorless courses work.

**Superseded** 2026-09-13 by P16 — a course is a subject, not a folder. The `kind: codebase` clause is gone: with no codebase course there is nothing for a generated
item to cite, so validation is structural only. Authored-wins, validate-before-serving and the cache all
still stand.

**Alternatives considered:** Generated-only (unverifiable content, no citation possible) — rejected.
Authored-only (every course needs a hand-written item bank before it can show a quiz) — rejected.

**Tradeoffs:** Depends on the content model and on the tutor producing schema-valid JSON; invalid generations
must fail loudly and be re-requested rather than half-rendered. Cached items need a home in the course
directory, which ties into the event log's projection layer.

## 2026-09-13 — API shape: resource routes, no version prefix, `/api/learning` kept as an alias

**Context:** The public shape today is `GET /api/learning`, `POST /api/chat`, `GET /api/stream`, `GET /health`.
Multi-course needs per-course addressing; the handoff analysis flagged versioning as an open question.

**Decision:** Add resource routes without a version prefix:

```
GET  /api/courses                  → discovered + registered courses
GET  /api/courses/:id              → course tree (units → lessons → modules)
GET  /api/courses/:id/learning     → raw LearningData for that course
POST /api/courses                  → register / unregister (writes .agent/courses.json)
GET  /api/learning                 → ALIAS for the default course (unchanged shape)
```

`/api/chat` and `/api/stream` gain an optional course selector but keep their existing behavior when it is
omitted. No `/api/v1` — we own the only client; version deliberately later if a second client appears.

**Alternatives considered:** `/api/v1/...` from the start — rejected as ceremony with one client. Nested
`/api/courses/:id/units/:n` routes now — rejected until the UI actually needs per-unit fetches.

**Tradeoffs:** Keeping `/api/learning` as an alias means two paths serve nearly the same payload until the
old dashboard is retired. The alias must be deleted when the vanilla UI is replaced (tracked as a task, not a
comment).

## 2026-09-13 — Misconception severity: tutor-emitted, three ratings, two derived display states

**Context:** The registry can hold several rows for one id (reproduced live: `MIS-003` ×3 in `learning-demo`),
and a learner must never be shown duplicates. But deleting rows is the one operation that can destroy real
content, because a duplicate row is indistinguishable from an authored row by id alone. Separately, the tray
had no way to distinguish a wrong core mental model from an isolated slip.

**Decision:**

- **Display collapses to one row per id** (P2). The backend `duplicate-registry-row:<id>` warning **stays** —
it is an invisible data-integrity signal, not a learner-facing display.
- **`severity` is tutor-emitted**, as an optional `record_learning` field and the 7th registry column:
`root` (alarm `#c83f3f`) · `partial` (warning `#d97706`) · `edge` (gold `#d4a72c`). Blank means unrated
(neutral). `resolved` (`#c9c6bd`) and `unrated` are **derived display states, never stored**:

  ```
  severityState = status === "resolved" ? "resolved" : (severity || "unrated")
  ```

- **Never inferred from the misconception prose.** Unrated must stay honest; deriving a rating from text is
invented data.
- **Updatable on re-assessment**, exactly like the corrected cell. An event that omits the field does not
clear a rating recorded earlier — only an explicit value overwrites.
- **A separate scale from mastery.** Severity describes *how a belief is wrong*; mastery describes *how well
a concept is known*. Rendered as a dot + label, colour as stroke, never fill.
- **Shared format.** The extension projection (`schema.ts`) and socrates-web's `learning-parser.ts` both
implement it and land together, along with the SCHEMA template.

**Alternatives considered:**
- Derive severity from the prose — rejected; it would fabricate ratings and contradict the evidence rule.
- Store all five values including `resolved`/`unrated` — rejected; two sources of truth for one state, and
  resolution must outrank a stale rating.
- Auto-dedupe registry rows — rejected; a duplicate is indistinguishable from authored content by id alone.

**Tradeoffs:** The 7-column migration mutates the header and separator of existing registry tables. It is
guarded to exactly the known 6-column shape, additive only (never removes a column or rewrites a cell),
one-shot, and reported as `registry-migrated-to-7-columns`. Early trays will be mostly `unrated` until a
tutor rates a misconception — accepted as the honest default over guessing.

**Flagged, deliberately not built:** a *derived* persistence signal — review cycles survived — rendered as a
small tick (never a colour). Behaviourally grounded, so honest to derive. No code until asked.

**Supersedes:** showing duplicates in the misconception tray.

## 2026-09-13 — P0 is a separate workstream in `pi-agent-harness`, not a socrates-web phase

**Context:** P0 changes global extensions, which run in **every** project's pi session. The user asked for it
to be a deliberate, separate workstream. While grilling this, `~/.pi` turned out to be a git repo
(`pi-agent-harness`, remote `LabidySabidy/pi-agent-harness`) with `agent/extensions/learning-state-manager.ts`
already tracked — so the premise that extension code sits outside version control was false.

**Decision:** P0 is its own workstream, committed in the `pi-agent-harness` repo. No symlink or junction is
needed, because the load path and the versioned path are the same path. Tests live beside the source in
`agent/extensions/` and run with `node --test "agent/extensions/**/*.test.ts"` (Node 24 strips types; `~/.pi`
has no package.json, and doesn't need one). Pure logic is extracted into pi-free modules so it is testable
without the extension runtime — the existing convention (`telemetry/buckets.ts`). Verification requires a
fresh pi session (GL-013).

**Alternatives considered:**
- Junction/symlink from a versioned directory into `~/.pi/agent/extensions/` — unnecessary since the source
  is already versioned, and it adds a link to maintain. Empirically validated as safe anyway
  (`readdirSync(withFileTypes)` reports a junction as `isSymbolicLink: true`, and pi's loader accepts
  `isSymbolicLink()` for files and directories at `loader.js:584,592`), so it remains available if the source
  ever moves out of `~/.pi`.
- Vendoring a copy into socrates-web — rejected; socrates-web is one app, the extensions serve every project,
  and a copy would drift.

**Tradeoffs:** P0 now spans two repos, so socrates-web's `npm test` cannot cover it and there is no single
command that gates everything. Mitigated by the documented test command above and by keeping the extension
tests self-contained. Also means P0 lands as a `pi-agent-harness` commit, reviewed on its own terms.

## 2026-09-13 — Course paths are chosen with a server-side folder browser, on a loopback bind

**Superseded** 2026-09-13 by P16 — a course is a subject, not a folder. There is no folder to choose: a course is created in the store from a subject, so `GET /api/fs`,
`fs-browse.ts` and `FolderPicker.tsx` are deleted. Nothing in the app browses the filesystem.

**Context:** Adding a course required typing an absolute path by hand. Browsers cannot hand a local
server a real directory path: the File System Access API withholds the absolute path by design, and
`<input type="file" webkitdirectory">` only yields uploaded file objects. A local app that must act on
a path it can read therefore has to browse on the server and send paths back — which is what every
local tool does, but it widens this API: `GET /api/fs` lists directory names under a caller-supplied
path.

**Decision:** `GET /api/fs?path=…` returns the sub-directories of a path, and the drive roots when no
path is given. Directory names only — never file names, never contents — so it can be used to choose a
folder and nothing else. Directories that are courses are flagged (`isCourse`) and courses sort first.
The picker accepts a typed or pasted path as well as clicking, because a deep tree by clicking alone is
tedious.

Paired with that: **the server now binds to `127.0.0.1` by default** (`HOST` overrides). It previously
bound every interface, which was tolerable while the API only read `.agent/learning`; publishing a
filesystem listing on the LAN is not.

**Alternatives considered:**
- `<input webkitdirectory>` — rejected; it uploads files and never reveals the absolute path, so the
  server could not register anything.
- `showDirectoryPicker()` — rejected; the handle cannot be turned into a path the server can read.
- A native OS dialog spawned server-side (PowerShell `FolderBrowserDialog`) — rejected; it needs an
  interactive desktop session, blocks the server, and is invisible to the browser that asked for it.

**Tradeoffs:** The app exposes directory names to anything that can reach the port, which is why the
default bind changed in the same commit. Anyone who wants LAN access sets `HOST=0.0.0.0` deliberately
and now knows what that publishes.

## 2026-09-13 — A course is a subject, not a folder. Codebase courses and the discovery stack are removed

**Context:** The app grew two ideas of what a course is. A `topic` course was a subject the learner
articulated; a `codebase` course was a directory somewhere on disk, found by scanning a root, listed in
a registry that could pin, order, label and hide entries, and whose generated quiz items had to cite
real repository files. That second idea produced: `COURSES_ROOT`, a one-level `*/.agent/learning` scan,
a `.agent/courses.json` registry, a "not initiated (no MISSION.md)" list, a folder picker, and the whole
citation and citation-resolution path.

**Decision:** A course is a **subject the learner articulates**. There is one store —
`~/.socrates/courses/<slug>/.agent/learning/` — and the pi session runs with `cwd` set there, so the
learning extensions write telemetry in place with no change. `PROJECT_DIR` and `COURSES_ROOT` are gone.
Starting a course asks for the subject, creates the directory, and dispatches
`/skill:scaffold-learning` through the same `askHref` mechanism the grill uses; the tutor then
interviews the learner and those answers become `MISSION.md`. `scaffold-learning` is the primary entry
point rather than a rescue path.

Removed outright, not deprecated and not behind a flag: `kind: codebase`; `cites` on items; citation
resolution; the `citation-not-found` path; repo-artifact grounding; the scan; the registry; pin / order
/ label / hide; `uninitiatedCourses`; the folder browser (`/api/fs`, `FolderPicker`, `fs-browse.ts`);
T-041 (writing `MISSION.md` into a project directory) and T-044 (a started-but-unscaffolded course),
both superseded by the articulate flow. Tests covering removed code were deleted with it.

**CONSEQUENCE, recorded rather than buried: a generated item can no longer be grounded in a real
file.** `T-042` said validation was structural plus citation-resolvable, so a wrong-but-well-cited item
could pass; with citations gone, validation is structural only. Nothing in use regresses: `topic`
courses never had citations, and the citation path was introduced for codebase courses in the same
project, never relied on outside it.

**Alternatives considered:** keeping `codebase` as an unused variant behind a flag — rejected; a flag
leaves the registry, the scan, the folder picker and the citation tests to maintain, and the user asked
for removal. Migrating course directories in place — rejected; a single store is what makes
`PROJECT_DIR` deletable.

**Tradeoffs:** Courses no longer live beside the code they might be about, and a learner cannot point at
an existing project. In exchange there is one storage model, one entry point, and no filesystem browsing
in the API. DriftScout's `.agent/learning` is migrated in as a one-time copy.

## 2026-09-13 — Known gap: the app depends on the developer's local harness (deferred)

**Context:** Socrates-Web drives a real `pi` agent from `~/.pi/agent`, and the learner-facing
experience depends on things that live there and nowhere else: the `learning` and `passivity`
extensions (telemetry, SCHEMA/SESSIONS projection, the passivity intercept) and the skills the app
dispatches by name (`/skill:scaffold-learning`, and the grill family). The server invokes the global
`pi` binary and inherits that install. Nothing in this repository declares, versions or ships any of
it, so **the app works as designed only on a machine where this developer's harness is installed at
`~/.pi/agent`** — a second machine, or a fresh clone, gets a tutor with no telemetry pipeline and no
`/skill:scaffold-learning` to dispatch.

**Decision:** Accept this as a known gap for now, deliberately, and record it so it is not later
mistaken for a regression. Packaging and isolation are **deferred**, not overlooked: no
`PI_CODING_AGENT_DIR` work, no moving the extensions or skills into this repo, no
`--no-extensions`/`--no-skills` wiring, and no change to how the app selects a model. The reason to
defer is that it is a substrate swap which does not touch the learning model: the pedagogy, the store
and the API are the same either way, so it costs nothing to do after the owner has tested and the
baseline is stable.

**Documented follow-up (the plan, not built):** give the app its own agent home — a repo-owned
directory passed as `PI_CODING_AGENT_DIR` — containing the `learning` and `passivity` extensions and
the skills this app dispatches, so a fresh clone runs without a hand-installed harness. That work
turns the current install into a product, and it is the prerequisite for anyone else running this.

**Alternatives considered:** pinning the extensions into the repo now — rejected as premature while
the app is still being tested and the extension surface is changing; a startup check that fails
loudly when `~/.pi/agent` lacks the extensions — cheap and tempting, but it would bake the dependency
in harder by making the local layout contractual, which is the opposite of the follow-up.

## 2026-09-14 — A rename follows the open page, and the error stops being the server's sentence

**Context:** reproduced live. The learner sat in a lesson while the scaffold named the course; the
directory renamed and the page did not follow, because only the course page handled the
`{type:"renamed"}` frame. A refresh then rendered the API's own phrasing — `unknown course:
bicycle-wheel-truing-and-tensioning` — with an empty transcript, and that message STAYED on screen after
navigating to the correct lesson.

**Decision:** three rules, all in one place each.

1. **Follow once, only for the page holding the old id, never mid-turn.** `shouldFollowRename` in
   `web/src/course-error.ts` is the whole rule: `from === courseId`, not `busy`, and not already
   followed. The unit is preserved, so the learner stays on the concept they were reading.
2. **The deferred case is a boundary, not a bug.** A rename requested while a turn is running is deferred
   by the server (Windows cannot rename a live process's cwd) and the page does not follow it mid-turn —
   the tutor would go on writing into a directory the page has left. The page keeps the old id until the
   learner acts; a reload recovers, because reconciliation runs on read. Observed: the stale id shows the
   friendly state, not an error.
3. **An unknown course id is a sentence with a way back.** `courseErrorView` names a cause only when the
   server's text does, so a rename is called a rename and a 500 is not. The raw string is never rendered.
   Errors also clear on any route change (`LessonPage`), because a message that outlives the problem it
   describes is worse than no message.

**Alternatives considered:** mapping old ids to new ones so a stale URL keeps working — rejected, and it
is forbidden by the naming model: an alias table exists to preserve a name that is not the truth. The old
URL may 404, and now it 404s legibly.

**Tradeoffs:** a stale page after a deferred rename must be reloaded. Accepted: the alternative is
interrupting a running tutor turn to move a directory out from under it.
