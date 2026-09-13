# Socrates-Web — Task Tracker

> Status: `[ ]` todo · `[x]` done. Stop after each phase for review.
> Phase order and rationale: `PLAN.md`. Decisions: `DECISIONS.md`. Design resolutions:
> `.agent/grill/socrates-persistence-and-cutover.md`.

## P0 — Telemetry durability: DEF-001 fix + session store

> **Separate workstream.** Files live in the `pi-agent-harness` repo (`~/.pi`), *not* here — they are
> global extensions that affect every project's pi session. Tests: `node --test "agent/extensions/**/*.test.ts"`
> (run from `~/.pi`). Hook behavior verifies only in a **fresh pi session** (GL-013); pure-module tests
> run in-session.

- [x] **T-001** Extract pure, pi-free logic into `agent/extensions/learning/` (`schema-ops.ts`, `events.ts`,
      `projection.ts`) so it is testable without the extension runtime — matching the existing
      `telemetry/buckets.ts` convention. Tests written **first**.
      **Done when:** `node --test` passes against fixtures, with no `pi-coding-agent` import in any pure module.
      **Done** — `agent/extensions/learning/{telemetry,events,schema}.ts` + `learning.test.ts`;
      `node --test agent/extensions/learning/learning.test.ts` → 17/17 pass. No pi imports in the pure modules.
- [x] **T-002** Append-only `events.jsonl` writer + `session_start` / `session_end` / `session_shutdown` hooks
      writing deterministic session events from `ctx.sessionManager`.
      **Done when:** a session in which the tutor emits nothing still appends `session_start` and `session_end`.
      **Code complete** — `io.ts` + hooks in `learning/index.ts`. Awaits the T-009 restart read-back.
- [x] **T-003** Projection: events → `SCHEMA.md` **owned regions only**, with `*_drift` events when an owned
      field disagrees with the log. Idempotent replay.
      **Done when:** projecting the same log twice yields byte-identical output, and an authored field
      (`Definition`, `Connections`) survives a full replay unchanged.
      **Done** — `schema.ts`; tests cover idempotency (`changed === 0` on second pass) and authored-prose survival.
- [x] **T-004** Misconception registry: upsert by `id` (never append a duplicate), and write the
      corrected-model cell when status flips to `resolved`.
      **Done when:** a test proves a second event with the same `id` updates one row; the current 3× duplicate
      rows in `learning-demo` are no longer reproducible.
      **Done** — `reduceEvents` keys by id; `projectSchema` inserts-or-updates in place (never deletes).
      Test asserts a repeated id leaves exactly one row.
- [x] **T-005** Register a `record_learning` **tool** (typebox-validated) alongside the legacy
      `<learning-telemetry>` tag parser; a malformed payload must be rejected loudly, not dropped.
      **Done when:** tests cover a valid tool payload, an invalid payload, and tag-fallback parsing.
      **Done** — tool registered in `index.ts` with `promptSnippet` + `promptGuidelines`; rejected payloads
      write a `telemetry-errors.log` line and return a message telling the model what was wrong.
      Tag fallback retained and tested.
- [x] **T-006** `telemetry_missing`: when a turn shows grill activity but produced no telemetry, append the
      event and log it. The DEF-001 silent no-op is gone.
      **Done when:** a test asserts the event and log line for a no-telemetry turn with grill evidence.
      **Done** — `signal.ts` detects a grill skill expansion in the *most recent* user message; `turn_end`
      appends `telemetry_missing` + logs when the turn produced nothing. 4 tests cover the detection.
- [x] **T-007** `SESSIONS/<YYYY-MM-DD>-<HHmm>-<sessionid8>.md` projection — written at `session_start` with
      `status: open`, finalized at `session_end` or by the next `session_start`.
      **Done when:** a crashed session (no `session_end`) still leaves a file that the next session finalizes.
      **Done** — `sessions.ts` (`renderSessionMarkdown`, `staleSessions`); tests cover the open record, the
      populated record, and stale-session detection excluding the current session.
- [x] **T-008** Delete `agent/extensions/learning-state-manager.ts` (superseded by `learning/index.ts`) so pi
      does not double-load two handlers for the same events.
      **SEQUENCING — do not do this alone:** deleting it before `learning/index.ts` exists removes the only
      telemetry writer from **every** project's pi session (a harness regression, not a neutral cleanup).
      It must land in the *same commit* as the new entry point (T-002–T-005).
      **Done** — removed in commit `e9000af`, the same commit that adds `learning/index.ts`. `agent/extensions/`
      now has exactly one learning entry point (`learning/`, resolved via its `index.ts`).
- [x] **T-009** Fresh-session verification + commit in `pi-agent-harness`.
      **Done** 2026-09-13 — run in a throwaway copy of `learning-demo`, NOT DriftScout: DriftScout's
      `.agent/learning/` is untracked (`git ls-files` → empty), so a write there is unrecoverable, and badges
      drive the mastery states the derivation reads. Fresh `pi -p` processes with cwd set to the copy (GL-013).
      Deterministic: `session_start` → `session_end` in order, `SESSIONS/<date>-<time>-<id8>.md` with
      `Status: closed` / `Turns: N`, no `telemetry-errors.log`. Grill: badge + sm2 event pair; `MIS-005`
      inserted once then UPDATED (not duplicated) by a second turn; authored `MIS-001`–`MIS-004` rows intact;
      projection diff = 4 SM-2 lines + 1 inserted row; no unpaired surrogates; re-projection reports
      `changed: 0`, byte-identical. Negative path: one `telemetry_missing` per grill turn **after** fixing the
      over-report bug (commit `a577886`).
      **Known limitation found:** pre-existing duplicate ids (`MIS-003` ×3) are not collapsed — the projection
      updates the first row and leaves the rest, because it never deletes. Needs a duplicate-id warning.

## P1 — Content model + API surface
- [x] **T-010** `course-model.ts` — derivation (unit = concept card) returning `{ tree, warnings[] }` with all
      seven edge cases from the grill doc. **Done when:** tests cover 0 concepts, missing SCHEMA.md, missing
      MISSION.md, duplicate concept names, unknown badge, and a `COURSE.md` naming a nonexistent card.
      **Done** — `course-model.ts` + 17 tests; all seven edges covered, plus a nonexistent course directory.
- [x] **T-011** `COURSE.md` override parser (lesson groups, module order/types, assessment placement, `kind`).
      **Done when:** a manifest overrides the derived tree and `manifest > derived` precedence is tested.
      **Done** — `parseCourseManifest()`; a malformed manifest falls back to the derivation with
      `manifest-invalid:<reason>` instead of producing a half-built tree. `@concept` refs attach mastery;
      a dangling ref is preserved with `missing: true` + `unknown-lesson:<name>`.
- [x] **T-012** 5-state mastery map (badge → state / colour / ring) as a single exported union; no sixth state.
      **Done when:** a test asserts every badge maps, and an unknown badge renders `Not started` + warning.
      **Done** — `MASTERY_BY_BADGE` / `masteryOf` / `aggregateMastery` / `countByMastery`; exactly five states
      asserted, unknown badge reads Not started, aggregate never divides by zero.
- [x] **T-013** `courses.ts` — `COURSES_ROOT` scan (one level), `.agent/courses.json` overlay
      (pin / order / label / hide / add), ignore list. **Done when:** tests cover scan discovery, hide, pin order,
      and a registry entry outside the scan root.
      **Done** — 14 tests, each against its own throwaway root. Missing root, corrupt registry, unreadable
      entry, and duplicate basenames all degrade to warnings. Catalogue concept counts unique-counted so they
      agree with the derived unit count.
- [x] **T-014** Routes: `GET /api/courses`, `GET /api/courses/:id`, `GET /api/courses/:id/learning`,
      `POST /api/courses`; `/api/learning` unchanged as an alias. **Done when:** an alias-shape test proves the
      old response is byte-compatible.
      **Done** — `startServer()` exported (importing `server.ts` no longer has side effects); 12 integration
      tests boot the real router on an ephemeral port. The alias test asserts
      `text === JSON.stringify(parseLearning(dir), null, 2)`.
- [x] **T-015** Watcher covers N courses. **Done when:** editing SCHEMA.md in a non-default course pushes a
      `reload` event for that course only.
      **Done** — one debounced watcher per discovered course; `reload` carries `course` plus the rebuilt tree.
      Watchers resync on register/hide/unregister. Observed live: `[watcher] watching 7 course(s)`.
- [x] **T-016** `docs/CONTENT-MODEL.md` — the derivation rules and the warnings table. **Done when:** it matches
      `course-model.ts` exactly (checked by reading both).
      **Done** — derivation table, five-state mastery table, full warnings table, manifest grammar, module
      taxonomy, discovery rules, and the spike evidence for why phases are never units.
- [x] **T-033a** Vendor a course fixture set under `test/fixtures/` so no test depends on an external project.
      **Done** — 7 fixture courses (basic, empty-concepts, no-schema, no-mission, duplicate-concepts,
      unknown-badge, manifest); `.gitignore` `.agent/` anchored to `/.agent/` so fixtures stay committable.
- [x] **T-032** Misconception severity end-to-end — shared format across the extension and this repo.
      `severity: root|partial|edge` on the 7th registry column + optional `record_learning` field; blank means
      unrated; `resolved`/`unrated` derived, never stored; never inferred from prose; updatable on
      re-assessment, and an omitted field does not clear a prior rating.
      **Done** — extension `telemetry.ts`/`events.ts`/`schema.ts`/`index.ts` (+5 tests → 35 pass),
      `learning-parser.ts` (+`SEVERITIES`/`severityState`/`SEVERITY_COLOR`, +3 tests → 9 pass),
      `SCHEMA.md.template` 7 columns, `docs/EVENT-SCHEMA.md` (raw schema + column-ownership table +
      migration rules). Guarded one-shot additive migration of 6-column tables, reported as
      `registry-migrated-to-7-columns`.

## P2 — Frontend scaffold + real-data course browser (Vite + React + TS)
- [x] **T-017** `web/` Vite + React + TS scaffold, dev proxy `/api` → Node, tokens as CSS custom properties,
      self-hosted-or-fallback fonts. **Done when:** `tsc --noEmit` and `vite build` are clean.
      **Done** — React 19 / Vite 8 / strict TS; `tsc --noEmit` clean, `vite build` 28 modules → 235 kB (74 kB gzip).
      Tokens in `web/src/theme.css`; the font stack has serif fallbacks behind the Google Fonts link.
- [x] **T-018** Hash router + app shell (top bar, emblem, wordmark). **Done when:** routes round-trip and
      back/forward work.
      **Done** — `#/home`, `#/course/:id`, `#/course/:id/:unit`; an empty hash is normalised so URLs are
      shareable. Hashes need no SPA catch-all, so dev and prod route identically.
- [x] **T-019** Course page: unit rail (mastery rings, `aria-current`, course switcher) + module pane
      (lesson groups, module rows, type icons) from real data. **Done when:** browser-verified against a real course.
      **Done** — browser-verified via agent-browser: switching course replaced the whole rail
      (`react-state/hooks` → `alpha-one/beta-two/gamma-three`); selecting a unit updated the heading, the
      breadcrumb, `aria-current`, the ring stroke (`#4a6fa5` 0.50 → `#2d7a4c` 0.78) and the module pane.
- [x] **T-020** Home catalogue (greeting, continue strip, mastery counts, course grid) from real data.
      **Done when:** browser-verified; no fabricated percentage anywhere.
      **Done** — counts summed from each course's real `masteryCounts` (Mastered 1 / Proficient 2 / Familiar 4
      over 8 courses). **The continue strip is deliberately absent**: recency needs the session journal, which
      has no endpoint yet, and a fabricated percentage there is exactly what this project removed.
- [x] **T-021** Telemetry rail: SM-2 panel, misconception tray, "Memory strength (SM-2 estimate)" with an
      "insufficient data" state. **Done when:** browser-verified; every number traces to a real field.
      **Done** — SM-2 reads the five SCHEMA.md fields; the estimate documents its formula in `web/src/memory.ts`
      and reports "insufficient data" rather than 0% when nothing has been reviewed.
- [x] **T-033** Misconception tray renders **one row per id**, never duplicates. Dot + label by
      `severityState`, colour as stroke: root `#c83f3f` · partial `#d97706` · edge `#d4a72c` ·
      resolved `#c9c6bd` · unrated neutral. No counts, no repeated beliefs.
      **Done** — browser-verified against the `course-duplicate-misconceptions` fixture (created for this
      check; registry holds `MIS-003` ×3): rendered ids are `MIS-003` ×1, `MIS-004`, `MIS-005`, `MIS-006`,
      ordered root → partial → unrated → resolved, header reads "3 uncorrected". The backend
      `duplicate-registry-row` warning is still emitted and still not shown.
      **Accepted limitation (do not fix unless asked):** resolution outranks severity, so a resolved `root`
      misconception no longer displays as fundamental. If it ever matters, render resolved rows with the
      severity dot at low opacity — the stored rating is still in the row and in the event log.
- [x] **T-022** **Gateway:** confirm the sparser Home (no streaks / levels / ep / badge discs / subject chips) is
      wanted. **Done when:** the user confirms in writing; if not, the scope is updated before T-023.
      **CONFIRMED in writing 2026-09-13** — ship the sparser Home. Every number shown must have a backing field;
      "Continue where you left off" is backed only by the session journal.
- [x] **T-023** Cutover, **last action of the phase**: serve `web/dist`, delete `public/`, delete the
      `/api/learning` alias — one commit, so a single `git revert` restores the old UI.
      **Done** — the built UI was browser-verified from the Node server on 3850 **before** the deletion, then
      `public/` and the alias were removed in the same commit. Static root is `web/dist` and the server warns
      when it is missing; `web/dist/` is gitignored and `npm run build` produces it. Tests pass a throwaway
      `staticDir`, so `npm test` does not depend on the build having run.

## P3 — Add-a-course
- [x] **T-038** Complete the module taxonomy with the four missing types. `course-challenge`, `primary-source`,
      `faq`, `ai-activity` added to `AUTHORED_MODULE_TYPES`, the manifest parser accepts them (its type group was
      `[a-z]+`, which rejected hyphenated names), and each has a glyph and a label. **Vocabulary and rendering
      only** — no FAQ, primary-source, or interact *screens*; those stay deferred per PLAN.md.
      **Done** — `test/fixtures/course-taxonomy/` authors all 13 types; 2 server tests assert each round-trips
      from `COURSE.md` (including an `@concept` ref attaching mastery to a new type), and 2 client tests assert
      every type has a non-empty label and glyph and that the four are distinct from their neighbours. Glyphs and
      labels moved to `web/src/module-types.ts` so they are testable without a browser. Browser-verified: all 13
      render in the module pane with icon + label. Fix along the way: a resolved `@concept` ref set
      `missing: false` instead of leaving it absent.
- [x] **T-039** Make course discovery intentional — a course requires `MISSION.md`.
      **Done** — `CourseRef.initiated` is true only when `.agent/learning/MISSION.md` exists. Directories with a
      learning folder but no mission are excluded from the catalogue grid **and its count**, and listed under
      "Add or manage" as `not initiated (no MISSION.md)` so nothing is silently dropped. The "Add or manage"
      panel now shows **"Scanning <root>"** so the count is always explainable. The derivation is unchanged:
      a mission-less course still loads and still warns `no-mission` (test kept). Registry pin/order/label/hide
      unchanged.
      **Verified** — with `COURSES_ROOT=F:/Development` the catalogue shows exactly **1** course (DriftScout,
      5 concepts) and "Scanning F:/Development"; against a root holding the fixtures plus a bare
      `.agent/learning` directory, the catalogue shows 9 of 11 refs and "Not initiated (no MISSION.md) · 2"
      lists `bare-project` and `course-no-mission`.
- [x] **T-024** "Add course" form → `POST /api/courses`; hide/ignore affordances; no-results state.
      **Done when:** browser-verified — an added course survives a restart; hiding removes it without touching disk.
      **Done** — browser-verified: registering a course outside the scan root from the form wrote the registry
      (`fromScan: false, fromRegistry: true`), it appeared in the catalogue, Hide moved it out of the grid while
      keeping it in the manage list (`hidden: true`, visible 9 of 10), Unhide restored it, and a search with no
      matches rendered the no-results panel with a working Clear filters. Disk is never touched by any action.
      A test now gitignores `test/fixtures/**/.agent/courses.json` so registering cannot dirty a fixture.
- [x] **T-035** Journal endpoint — read a course's `SESSIONS/` (and its `events.jsonl`) so session history is
      reachable by the client. `GET /api/courses/:id/journal` (sessions newest-first with date, turns,
      concepts touched, transcript path) and `GET /api/courses/:id/journal/:file` for one session's markdown.
      `CourseRef` gains `sessions: { count, lastAt }` **parsed from the SESSIONS filenames**, so the catalogue
      knows recency without reading every course's log.
      **Done** — `journal.ts` + 9 unit tests + 5 route tests. Content comes from the SESSIONS *projection*, not
      the raw event schema; `events.jsonl` is read only for counts, so the client is not coupled to the
      writer's internal shape. Degrades: no journal → empty list, malformed log line counted and skipped,
      traversal and non-session names refused with 404.
- [x] **T-036** **The continue strip** — a headline element of the design reference, backed ONLY by the journal.
      Pick the course with the most recent session and show the real date, session count, and where it stopped.
      It must render nothing at all when no course has a journal entry — never a placeholder percentage.
      **Done** — browser-verified **both ways**: with a journal the strip reads "Continue where you left off /
      resume from a previous session … / Last session Sep 10, 2026 · 2 sessions · not closed cleanly"; against a
      root whose courses have no sessions, `.resume` count is 0, the phrase appears 0 times, cards show no
      session counts, and the rest of the catalogue renders unchanged. `mostRecent()` is unit-tested to return
      null when no course has a journal, when a count has no timestamp, and to pick by recency not volume.

## P4 — Bridge restart on switch + chat-first lesson
- [ ] **T-025** `process-bridge.ts` `switchCourse(dir)` — kill tree, warm respawn; mid-turn switch kills the
      stream and surfaces it. **Done when:** tests cover switch-while-idle and switch-while-streaming.
- [ ] **T-026** `/api/chat` + `/api/stream` accept an optional course selector; unchanged when omitted.
- [ ] **T-027** Lesson view: EXPLAIN → SHOW → ASK, Socratic Reasoning drawer fed by `thinking_delta`, pinned
      composer, Exit Lesson preserving position. **Done when:** browser-verified streaming real pi output.

## P5 — Assessments
- [ ] **T-028** Authored items from `COURSE.md`, else pi-generated under a validated structured contract
      (`kind: codebase` items cite real artifacts), then cached. **Done when:** an invalid generation fails loudly.
- [ ] **T-029** Quiz UI: Check → Try again → Next → Finish, hints 1/3→3/3, two-mistake gate, toasts,
      completion panel. **Done when:** browser-verified across all five branches.

## P6 — Interactives and games
- [ ] **T-030** Interactive + game module types rendered from a declared or generated definition.
      **Done when:** browser-verified, reduced-motion respected, canvas loops cancelled on leave.
- [ ] **T-031** Interactive generation through pi for a concept, validated and stored.

## Backlog — flagged, deliberately not built
- [ ] **T-034** Derived persistence signal — review cycles survived — rendered as a small tick, never a
      colour. Behaviourally grounded, so honest to derive. **Not to be started without an explicit ask.**
- [x] **T-037** Client test for the tray + mastery colour mapping, so drift is caught without a browser.
      **Done** — `web/src/ui.test.ts`, 11 tests, run by `npm --prefix web test` and wired into the root
      `npm test` so it cannot be orphaned. Covers the one-row-per-id collapse and its winner rules, severity
      ordering, the five mastery states, the memory-strength "insufficient data" case and its monotonicity,
      `filterCourses`, and `mostRecent`. Pure logic moved to `web/src/select.ts` so it needs no browser.
