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
  `POST /api/courses`; `GET /api/learning` unchanged as an alias for the default course.
- Extend the debounced watcher to N courses.
- **Misconception severity** — tutor-emitted `root`/`partial`/`edge`, stored as the 7th registry column and
  an optional `record_learning` field; blank means unrated. Never inferred from prose. `resolved`/`unrated`
  are derived display states. Shared format: extension projection + `learning-parser.ts` + SCHEMA template,
  landed together.
- **Done when:** `curl /api/courses` lists real discovered courses; `/api/courses/DriftScout` returns a
  units tree derived with zero new files; `/api/learning` still returns the old shape byte-for-byte; a
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
- [ ] `/api/learning` returns the old shape; `/api/courses` and `/api/courses/:id` return real data.
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
