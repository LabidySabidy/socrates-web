# Plan — Socrates-Web: real Platform app from the design handoff

## Goal
Turn the single-course read-only dashboard into the handoff's adaptive learning platform — a
multi-course catalogue, a two-pane course browser, a chat-first lesson wired to the real pi bridge,
and validated assessments — with every panel reading real files or the real pi stream.

## Approach
Derive the Course → Units → Lessons → Modules tree from the `.agent/learning` markdown that already
exists (spike-proven: one unit per SCHEMA concept card; PLAN phases cannot be joined to concepts and
are treated as course context only), with an optional `COURSE.md` manifest as an override. Add a
per-course append-only `events.jsonl` so learning history survives — today `SCHEMA.md` is mutated in
place and a single writer bug destroys data permanently (DEF-001). Replace the vanilla frontend with
Vite + React + TypeScript to carry five screens plus a quiz state machine, keeping the Node server as
the API. Do the telemetry fix first: it is independent, it is a live data-loss bug, and the session
journal is what makes "Continue where you left off" honest.

## Phases

### P0 — Telemetry durability (DEF-001 fix + session store)
**Separate workstream.** This edits *global* extensions that affect every project's pi session, and it lands
as a commit in the `pi-agent-harness` repo (`~/.pi`), not in socrates-web — see DECISIONS. Extension tests run
from `agent/extensions/` via `node --test "agent/extensions/**/*.test.ts"`; verification needs a fresh pi
session (GL-013).

Fixes the live defect and lays the event log everything else reads.
- Log the no-op: a telemetry block that never arrives must produce a `telemetry_missing` event and a
  log line, not a silent `return`.
- Upsert, don't append: misconception registry rows keyed by `id`; write the corrected-model cell when
  status flips to `resolved` (today it is always `|  |`) — fixes the 3× duplicate rows in
  `learning-demo`.
- Replace the `<learning-telemetry>` text protocol with a schema-validated `record_learning` **tool**
  registered by the extension; keep the tag parser as fallback for older turns.
- 3-layer store, per course: `events.jsonl` (append-only) → derived `SCHEMA.md` + `SESSIONS/<date>-<slug>.md`.
  `session_start` / `session_end` written from `ctx.sessionManager` on hooks — no model cooperation.
- **Done when:** a fresh session where the tutor emits nothing still produces `session_start`/
  `session_end`; a turn that records a misconception yields exactly one registry row that a second
  turn updates rather than duplicates; `telemetry_missing` appears when a grill turn emits no event.

### P1 — Content model + API surface
- `course-model.ts`: derivation (course/unit/lesson/module) + `COURSE.md` override parser; precedence
  manifest > derived. Unit mastery ring from the card badge via the 5-state map (no sixth state).
- `docs/CONTENT-MODEL.md`: the derivation rules, so they cannot drift into heuristics.
- `courses.ts`: scan `COURSES_ROOT` one level for `*/.agent/learning`, `.agent/courses.json` overlay
  (pin / order / label / hide / add), ignore list.
- API: `GET /api/courses`, `GET /api/courses/:id`, `GET /api/courses/:id/learning`,
  `POST /api/courses`; `GET /api/learning` was an alias for the default course until the P2 cutover removed it
  with the old UI (T-023).
- Extend the debounced watcher to N courses.
- **Misconception severity** — tutor-emitted `root`/`partial`/`edge`, stored as the 7th registry column and
  an optional `record_learning` field; blank means unrated. Never inferred from prose. `resolved`/`unrated`
  are derived display states. Shared format: extension projection + `learning-parser.ts` + SCHEMA template,
  landed together.
- **Done when:** `curl /api/courses` lists real discovered courses; `/api/courses/DriftScout` returns a
  units tree derived with zero new files; **`GET /api/courses/:id/learning`** returns clean structured JSON
  for that course; a
  misconception row round-trips its severity through parser and projection.

### P2 — Frontend scaffold + real-data course browser (Vite + React + TS)
**Dev workflow:** `npm run build` (builds `web/`), then `npm start`. For live reload, run
`npm run dev:api` and `npm run dev:ui` — the Vite server proxies `/api` to Node on 3850.
The static root is `web/dist`; `public/` and the `/api/learning` alias were removed together in the
cutover commit, so one `git revert` restores the old UI.
- Vite + React + TS under `web/`; dev server proxies `/api` to Node; Node serves `dist/` in prod.
- Handoff tokens as CSS custom properties; Cormorant Garamond + Lora; outline-only buttons, hairline
  rules, whisper shadows, `prefers-reduced-motion` gate.
- Hash router (`#/home`, `#/course/:id/:unit`, `#/lesson/...`, `#/quiz/...`, `#/lab/...`).
- Home catalogue (greeting, continue strip, mastery counts, course grid) + Course page (unit rail with
  mastery rings and `aria-current`, module pane with lesson groups and module rows) — **all from real
  data**. No progress percentages, streaks, levels, ep, or badge discs.
- Telemetry rail: SM-2 panel, misconception tray, and memory strength labelled
  **"Memory strength (SM-2 estimate)"**, rendering "insufficient data" rather than 0% when unreviewed.
- **Misconception tray renders ONE row per id** — never show a learner duplicates. No counts, no repeated
  beliefs. Each row carries a severity dot + label (stroke, not fill) from the five-state scale: `root`
  `#c83f3f` · `partial` `#d97706` · `edge` `#d4a72c` · `resolved` `#c9c6bd` · `unrated` neutral. Distinct
  from the mastery scale. The backend duplicate warning stays invisible — an integrity signal, not display.
- Delete `public/index.html` + `public/app.js` and the `/api/learning` alias once the old UI is gone.
- **P2 gate (confirm before shipping):** the sparser Home — no streaks, levels, energy points, badge discs,
  or subject chips — is a deliberate deviation from the handoff. Confirm it is wanted before P2 ships; do not
  let it pass silently.
- **Done when:** browser-verified — real courses listed, course switch swaps the rail and pane,
  unit selection updates the module pane, and no panel shows a number that has no backing field.

### P3 — Add-a-course
- "Add course" form → `POST /api/courses` writing the registry; ignore/hide affordances.
- No-results state, subject-free filtering (search only until a subject taxonomy exists — deriving
  subjects from prose would be invented data).
- **Done when:** browser-verified — adding a real directory makes it appear in the catalogue and
  survive a server restart; hiding one removes it without touching disk.

### P4 — Bridge restart on course switch + chat-first lesson
- `process-bridge.ts`: `switchCourse(dir)` — kill the tree, warm-spawn for the new course; a switch
  during an active turn kills the stream and surfaces it to the client rather than dropping tokens.
- `/api/chat` + `/api/stream` accept an optional course selector; behavior unchanged when omitted.
- Lesson view: EXPLAIN → SHOW → ASK, Socratic Reasoning `<details>` drawer fed by `thinking_delta`
  (stripped from visible prose), pinned composer, Exit Lesson preserving position.
- **Done when:** browser-verified — streaming real pi output into the lesson; switching course and
  prompting reaches the new course's directory; `Thinking:` text lands in the drawer, not the prose.

### P5 — Assessments
- `COURSE.md`-authored items when present; otherwise pi-generated under a structured-output contract
  (question, answer/choices, hints, step solution), **validated before serving**, then cached.
  `kind: codebase` items must cite real artifacts.
- Quiz UI: one problem at a time, Check → Try again → Next → Finish, hints 1/3→3/3, two-mistake gate,
  toasts, completion panel.
- **Done when:** browser-verified — correct, incorrect, hints 1/3→3/3, the gate after two mistakes, and
  completion; an invalid generation surfaces an error instead of half-rendering.

### P6 — Interactives and games
- Interactive + game as first-class module types, rendered from a declared or generated definition.
- Generation path through pi for a concept, with validation and a stored result.
- **Done when:** browser-verified — an interactive and a game both run, respect reduced motion, and
  their canvas loops are cancelled on leave.

## Files that will change

| File | Change | Phase |
|---|---|---|
| `~/.pi/agent/extensions/learning-state-manager.ts` | tool registration, upsert, no-op logging | P0 |
| `~/.pi/agent/extensions/session-journal.ts` | new — session events + `SESSIONS/` projection | P0 |
| `~/.pi/agent/extensions/*.test.ts` | new — extension tests (extensions are global, so tests live with them) | P0 |
| `course-model.ts` | new — derivation + `COURSE.md` override | P1 |
| `courses.ts` | new — scan + registry overlay | P1 |
| `docs/CONTENT-MODEL.md` | new — derivation rules | P1 |
| `server.ts` | per-course routes, N-course watcher, static from `web/dist` | P1–P2 |
| `process-bridge.ts` | `switchCourse()`, warm respawn | P4 |
| `web/**` | new — Vite + React + TS app | P2–P6 |
| `public/index.html`, `public/app.js` | deleted once the new UI lands | P2 |
| `test/*.test.ts` | extend node:test coverage | all |

## Acceptance criteria
- [ ] `npm test` passes (server + model + courses suites), `tsc --noEmit` and `vite build` clean in `web/`.
- [ ] `GET /api/courses/:id/learning` returns clean structured JSON per course (`/api/learning` was
      removed with the vanilla UI in P2 — see T-023); `GET /api/courses` and `GET /api/courses/:id` return real data.
- [ ] SCHEMA.md watcher still hot-reloads, now across N courses.
- [ ] Browser-verified per phase: catalogue, course switch, unit selection, chat streaming from real
      pi, quiz branches (correct / incorrect / hints 1/3→3/3 / two-mistake gate / completion),
      interactive + game.
- [ ] Zero fictitious sample content in production code paths (no Algebra, NASA, JS course, slope,
      Descartes, Mars, 40%, streaks, levels, ep, or badge discs).
- [ ] A session where the tutor emits nothing still persists a session record.

## Not in scope
- Authentication, multi-user, sync.
- **Deriving severity from misconception prose** — severity is tutor-emitted or blank/unrated.
- **Deriving the persistence signal** (review cycles survived, as a small tick) — flagged as behaviourally
  grounded and honest to derive, but explicitly **not built** until asked.
- Showing duplicate misconception rows in the tray — rendering collapses to one row per id.
- Subject taxonomy / subject chips (would be derived from prose — invented data).
- Streaks, levels, energy points, achievement badges.
- FAQ and Primary-source screens for `topic` courses (no content source; `codebase` courses get
  primary sources as real repo artifacts in P5/P6).
- The Descartes facsimile plate.
- Deleting `F:\Development\DriftScout\.agent\learning\` — it stays as the derivation fixture.

## Open questions
- **Extensions live outside this repo** (`~/.pi/agent/extensions/`), because they must run in any
  project's pi session. Their tests therefore live there too, so `npm test` in this repo cannot cover
  them. Accept the split, or vendor a copy into the repo for reference? Default: accept the split.
- **Which repo** becomes the first `kind: codebase` course — deliberately deferred to P1, when the
  model is visible.
- Whether `COURSE.md` should be able to declare a `subject`, which would re-enable the handoff's
  subject chips honestly.

## References
- `.agent/grill/socrates-persistence-and-cutover.md` — bounded grill: event-log schema + projections,
  derivation edge cases, Vite cutover. Resolutions adopted in P0–P2.
- `docs/HANDOFF-ANALYSIS.md` — separation note, gap analysis, spike evidence.
- `docs/handoff-shots/` — visual targets (home, course, lesson, quiz, lab, cockpit).
- `DECISIONS.md` — 2026-09-13 entries for every decision above.
- Handoff: `C:\Users\<user>\Downloads\Socrates-Web Unified Cockpit\design_handoff_socrates\`.

## Settled (formerly open questions)
- Content model: derived default, `COURSE.md` override (see DECISIONS).
- Add-a-course: scan + registry + API/UI, all three.
- Bridge: one process, restarted on switch.
- Retention: derived, labelled an SM-2 estimate.
- Frontend: Vite + React + TS; the no-build rule is retired.
- Assessments: authored when present, generated and validated otherwise.
- API: resource routes, no version prefix, `/api/learning` alias.
- Learning state: event-sourced, log per course.

---

# P16 — A course is a subject: remove codebase courses and the discovery stack

**Direction.** One storage model, one entry point. See the DECISIONS entry for the full rationale and
the recorded consequence for validation.

**Storage.** `~/.socrates/courses/<slug>/.agent/learning/{MISSION,PLAN,SCHEMA}.md`. The pi session runs
with `cwd` there, so the learning extensions keep working unchanged. `PROJECT_DIR` and `COURSES_ROOT`
are deleted. DriftScout's learning directory is migrated as a one-time copy.

**Entry point.** "Start a course" asks for the subject in the learner's own words, creates the course
directory, and dispatches `/skill:scaffold-learning` through `askHref` — the same mechanism as the
grill. The tutor interviews; the answers become `MISSION.md`.

**Phases** (one commit each, gates green at every step):
1. **Remove `kind: codebase` and citations** — model, validation, prompts, UI, fixtures, docs, tests.
2. **Add the store and the articulate entry point** — additive, so the app works throughout.
3. **Remove scan / registry / folder browser / T-041 / T-044** and their tests and fixtures.

**Files that will change:** `assessments.ts`, `interactives.ts`, `course-model.ts`, `courses.ts`,
`server.ts`, `web/src/**`, `docs/CONTENT-MODEL.md`, `DECISIONS.md`, `test/fixtures/**`, all suites.

**Acceptance criteria**
- [ ] No `codebase` kind, no `cites`, no citation resolution anywhere in the tree.
- [ ] No `COURSES_ROOT`, no scan, no registry, no `uninitiatedCourses`, no folder browser.
- [ ] `PROJECT_DIR` and `COURSES_ROOT` absent; `~/.socrates/courses/` is the only store.
- [ ] Starting a course from the UI creates the directory and dispatches the scaffold skill against a
      real agent.
- [ ] Gates green after each commit, with the guard's floors lowered as tests are deleted.
- [ ] DriftScout's learning directory migrated and rendering.

**Not in scope:** re-adding any path-based course concept in another form.

---

# P17 — Human-readable names: no identifier reaches the UI

## Goal
A learner never reads a slug. Every concept and unit name on every screen is human text, while the slug
stays the identity key everywhere an identity is required.

## Approach
Two layers, one function. A single pure `humanize()` lives in a shared module importable by the server
and the client (the precedent is `web/src/expr.ts`, imported by `course-model.ts`), and is applied at the
point where text becomes pixels — never earlier. Applying it earlier would silently change lookups,
module ids, grill prompts and telemetry keys, which is the bug this feature must not cause.

The source layer changes with it: the scaffold skill authors HUMAN card headings
(`### ⬜ Wheel anatomy and tension model`) and the app derives the slug, exactly the split the course
title now uses (H1 is the name, slug is derived). The id stays the slug and remains the telemetry key
and the MIS reference, so nothing downstream changes. This matters beyond aesthetics: a slugger destroys
casing, so `KPI`, `SAI`, `ERD` and `E46` are unrecoverable once slugged; names authored as words keep them.

Known limitation, accepted: a legacy slug id cannot recover casing the slugger already destroyed —
`kpi` humanises to `Kpi`. Legacy courses read correctly apart from acronym casing. No acronym
dictionary: it is a maintenance trap and it would be guessing.

## Phases

1. **humanize** — one pure function, tested: splits on `-` and `_`, capitalises each word, joins with
   spaces, idempotent on text that is already human.
2. **Source layer** — the scaffold skill authors human concept headings; the template shows a human
   heading rather than `<concept-name>`.
3. **Display layer** — `humanize` applied at every render site that prints a concept or unit name, plus
   the derived module titles built in `course-model.ts`.
4. **Browser verification** — open a unit and confirm no lowercase-dashed string appears anywhere.

## Files that will change

| File | Change | Phase |
|---|---|---|
| `web/src/humanize.ts` | new: the one pure function | 1 |
| `web/src/ui.test.ts` | tests for humanize + the render helpers | 1, 3 |
| `~/.pi/agent/skills/skill-scaffold-learning.md` | author human card names; say why | 2 |
| `~/.pi/agent/templates/learning/SCHEMA.md.template` | human heading placeholder | 2 |
| `course-model.ts` | derived module titles and the unit's group title are humanised at build | 3 |
| `web/src/components/CoursePage.tsx` | rail, unit heading, module titles, missing-card note | 3 |
| `web/src/components/LessonPage.tsx` | breadcrumb concept segment, lesson heading | 3 |
| `web/src/components/QuizPage.tsx` | unit title in the eyebrow, breadcrumb, and the quoted unit | 3 |
| `web/src/components/LabPage.tsx` | same three sites | 3 |
| `web/src/components/TelemetryRail.tsx` | CONCEPT cells and their grill links | 3 |
| `web/src/components/MisconceptionTray.tsx` | tray row concept and the `Grill <concept>` label | 3 |
| `web/src/components/JournalPanel.tsx` | the journal's "covered" list | 3 |
| `web/src/components/ContinueStrip.tsx` | the continue strip's "covered" list | 3 |

## Acceptance criteria

- [ ] `humanize` splits on `-` and `_`, capitalises each word, and is idempotent on human text
- [ ] no acronym dictionary exists anywhere in the change
- [ ] every render site that can print a concept or unit name is enumerated in the report and humanised
- [ ] the model's identity fields (`name`, `concept`, `id`, `title`) still hold the raw key, so lookups,
      module ids, grill prompts and telemetry keys are unchanged
- [ ] a course whose SCHEMA.md still holds slug names displays human text, with no migration
- [ ] a fresh scaffold writes human card names
- [ ] a unit page in the browser shows no lowercase-dashed string in the rail, breadcrumb, heading,
      module titles, tray or telemetry table

## Not in scope

- An acronym dictionary or any casing-recovery heuristic (explicitly rejected: a maintenance trap).
- Migrating existing SCHEMA.md files to human headings. Legacy courses are display-only affected.
- Changing the identity layer: concept ids stay slugs, and MIS references keep matching on them.
- The course title (done in P16) and anything from T-042 or T-034.

## Open questions

- None blocking. The one decision taken without asking: `humanize` is applied at render, not at the
  model boundary, because the model's `title`/`name` fields double as keys in three places
  (`CoursePage`'s unit lookup, `derivedModules`' ids, and the grill prompt).

## References

- `DECISIONS.md` — P16, the same name/slug split for the course title.
- `docs/CONTENT-MODEL.md` — "The name lives in one place".

## Current step

Plan written; implementing phase 1.
