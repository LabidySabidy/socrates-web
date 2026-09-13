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
- [x] **T-025** `process-bridge.ts` `switchCourse(dir)` — kill tree, warm respawn; mid-turn switch kills the
      stream and surfaces it. **Done when:** tests cover switch-while-idle and switch-while-streaming.
      **Done** — `switchCourse()` terminates without arming the shutdown latch, then warm-spawns. Two real
      bugs fixed: the old child's `exit` handler nulled `this.child` and orphaned the fresh process, and
      `kill()`'s latch made a respawn impossible. 3 tests using a cwd-reporting mock assert the process is
      replaced, that the new one runs in the new directory, that a same-course switch is a no-op, and that a
      swept bridge still completes a turn.
- [x] **T-026** `/api/chat` + `/api/stream` accept an optional course selector; unchanged when omitted.
      **Done** — a prompt carries `course`; the server resolves it, refuses an uninitiated one (409), switches
      the bridge, and persists `turnCourse` so a stream cannot subscribe to a different course than the live
      turn (409 with `activeCourse`). A mid-turn switch finalises the live stream with an explicit error
      rather than leaving the client waiting. 4 integration tests use the mock pi, so no real agent starts.
- [x] **T-027** Lesson view: EXPLAIN → SHOW → ASK, Socratic Reasoning drawer fed by `thinking_delta`, pinned
      composer, Exit Lesson preserving position. **Done when:** browser-verified streaming real pi output.
      **Done** — `#/lesson/:courseId/:unit`, opened from tutor-backed module rows (`recite`, `explain`,
      `ai-activity`); other types keep deferred screens. `web/src/turn.ts` accumulates the stream and splits
      reasoning from prose over the whole buffer (a tag can straddle chunks) and handles inline
      `<thinking>`/`Thinking:` too. Exit Lesson returns to the originating unit and restores the pane's scroll
      offset, saved on the way in. **Browser-verified against a real agent** (see PROGRESS).
- [x] **T-040** Cache headers: `index.html` must not be cached, hashed assets may be immutable.
      **Done** — without it a rebuilt bundle is invisible until a hard refresh, which silently invalidated a
      verification run. Found because the page was still executing a previous asset hash.

## P5 — Assessments
- [x] **T-028** Authored items from `COURSE.md`, else pi-generated under a validated structured contract
      (`kind: codebase` items cite real artifacts), then cached. **Done when:** an invalid generation fails loudly.
      **Done** — `## Quiz: <title>` sections in `COURSE.md` author items inline (answer, accepts, 3 hints,
      steps, cites), bound to the unit that precedes them. Authored items pass the SAME gate as generated ones.
      `assessments.ts` validates; nothing is served unless it validates. Citations are checked against the real
      filesystem, including `#Lnn` line anchors, and are mandatory for a `codebase` course. Generation runs a
      one-shot agent turn (`runTurn`, which never touches the SSE slot), extracts a fenced JSON block, validates,
      and caches to `<course>/.agent/learning/ASSESSMENTS/unit-N.json`.
      **Failure paths verified:** no JSON block → 422 with the reason and an excerpt; a citation to a nonexistent
      file → 422 `citation-not-found:<path>`; a timeout or spawn failure → 502. A partly invalid generation
      serves the valid items and reports `rejected`, never a silently partial quiz.
- [x] **T-029** Quiz UI: Check → Try again → Next → Finish, hints 1/3→3/3, two-mistake gate, toasts,
      completion panel. **Done when:** browser-verified across all five branches.
      **Done** — `#/quiz/:courseId/:unit`, opened from `quiz`/`test`/`course-challenge` module rows. All
      transitions live in the pure `web/src/quiz.ts` (17 client tests cover the branches) and the page only
      renders state. Browser-verified: incorrect (toast + hints offered + Skip withdrawn), hints 1/3 → 3/3 and
      no 4/3, the gate on the second mistake with BOTH choices (Start over resets index/dots/hints/mistakes;
      Keep going dismisses but retains them), correct (toast + lock + step solution + the repo citation shown),
      and completion ("Skill moved to Proficient", 3 of 3).

## P6 — Interactives and games
- [x] **T-030** Interactive + game module types rendered from a declared or generated definition.
      **Done when:** browser-verified, reduced-motion respected, canvas loops cancelled on leave.
      **Done** — `#/lab/:courseId/:unit` with tabs, opened from `interact`/`game` module rows. Two kinds:
      a **slider** (function plot with draggable parameters) and a **target-window game** (launch when the
      marker is inside the band). Both engines are pure and separately tested: `web/src/expr.ts` is a
      recursive-descent evaluator (no `eval`, so an authored or generated formula cannot run code) and
      `web/src/game.ts` holds the timing logic. **Browser-verified:** the plot draws 161 points, `m` and `b`
      both move the curve, the marker sweeps and both outcomes are reachable (2 hits / 13 misses over 15
      sampled launches), reduced motion is detected and disclosed, and the frame loop is cancelled on leave —
      **179 rAF calls while on the lab, 0 after navigating away**.
- [x] **T-031** Interactive generation through pi for a concept, validated and stored.
      **Done** — `GET`/`POST /api/courses/:id/interactives`. Authored specs win and generation is never run
      over them (tested with chat disabled, so a generation attempt would 503). Generated specs pass the same
      gate as authored ones: the formula must PARSE, every parameter must be coherent (min < max, positive
      step, value clamped), `xRange` must be a real interval, and a `codebase` course requires a resolvable
      citation. Cache: `INTERACTIVES/unit-N.json`. A reply with no usable spec returns 422 with the reason,
      never a partially rendered lab.

## Backlog — flagged, deliberately not built
- [x] **T-045** P8 — fix the generated-item grading contract (false negatives on correct answers).
      **Done** — items carry a `mode`. `short-answer` (default) is auto-graded and REQUIRES an answer of
      ≤ 6 words, ≤ 60 chars, and not more than one sentence; a longer answer without `mode: self-check` is
      **rejected** with `answer-too-long-for-auto-grading:<w>-words-<c>-chars-use-self-check`. `self-check`
      reveals the worked solution and the learner judges their own prose — never auto-marked. Authored items
      obey the same rule (a long one without `- **mode:** self-check` is dropped with that warning). The
      generation prompt now demands short checkable answers, explains why, and documents the escape.
      Normalisation folds unicode form, curly quotes/dashes, case, whitespace, a wrapping quote pair and
      trailing punctuation, so `SELECT.` and `"select"` match `select` — while keeping INTERNAL punctuation,
      because `status = 'approved'` and `status approved` are different answers.
      **Verified:** browser-verified that `STATUS = 'APPROVED'.` is graded correct (the original bug), that a
      self-check item offers "Show solution" instead of "Check" and is never auto-marked, that the solution IS
      visible before judging, and that the learner's verdict locks it. 9 client + 6 server tests.
      **Bug found while verifying:** revealing a self-check item showed the verdict buttons but not the
      solution — the steps were still gated behind `state.locked`, so the learner was asked to judge without
      seeing the answer.
- [ ] **T-042** Assessment validation has a known limit: it is **structural plus citation-resolvable**, so a
      wrong-but-well-cited generated item passes. Not solved, and not claimed to be — the mitigation shipped is
      that every quiz item shows its provenance (`authored` / `generated` / `cached`) and its citations. A
      future option is a second pass that checks the answer against the cited artifact.
- [x] **T-043** Close the assessment loop: an attempt moves the concept's badge.
      **Done** — the mapping is DERIVED, not invented: the only statement of a quiz-to-mastery relationship in
      this project is the design's mastery-gate copy ("You can no longer reach 'Proficient' on this attempt…
      after two mistakes"), so fewer than two mistakes qualifies the concept for **Proficient** and two or more
      qualifies it for **Familiar**. Four constraints, each documented in `docs/CONTENT-MODEL.md`: it never
      awards Mastered, it is raise-only, it applies only when a unit maps to exactly one concept, and it writes
      a `badge` EVENT rather than the file — socrates-web does not run the extension's projection, so the
      extension applies it on that course's next session.
      **Verified end-to-end:** a clean attempt returned `mastery: null` + `pendingBadge {alpha-one, 🟩,
      Proficient}`, appended `assessment_result` then `badge` to the log, left `SCHEMA.md` at `### 🟨 alpha-one`,
      and after one `pi -p` session in that course the file read `### 🟩 alpha-one` and the API reported
      `Proficient #2d7a4c ring 0.78`. Six mapping tests plus four route tests.
      **SM-2 deliberately untouched:** an interval is a function of the previous interval and ease factor, and no
      such rule for a quiz attempt is defined anywhere in this project — inventing one would be a fabricated
      scheduling rule. The tutor's telemetry owns those fields.
- [x] **T-041** A "start a course" affordance.
      **Done** — each not-initiated entry in "Add or manage" now offers **Start course**, which opens a small
      form and writes `MISSION.md` from the user's OWN words (destination required; artifact optional). The
      scaffold skill can enrich the rest of the mission later. It never overwrites an existing mission, an
      unanswered field is written as `<fill in later>` rather than fabricated, and the course appears in the
      catalogue immediately.
      **Browser-verified:** catalogue went from 1 course to 2, the new card is titled from the typed
      destination, the submit button stays disabled until the destination is non-empty, and the file on disk
      carries the typed words with `<fill in later>` for the blank field. 2 unit tests cover the refusals
      (empty destination, no learning dir, already initiated).
- [ ] **T-044** A UI-started course has `MISSION.md` only, so it renders **0 units** until the scaffold skill
      writes `PLAN.md`/`SCHEMA.md`. That is correct, but from the catalogue it looks broken. **Done when:** a
      started-but-empty course says so on its catalogue card and on its unit rail, and the course page offers
      the path to scaffold it. The unit rail's empty state exists; the card and the next-step affordance do not.
- [ ] **T-034** Derived persistence signal — review cycles survived — rendered as a small tick, never a
      colour. Behaviourally grounded, so honest to derive. **Not to be started without an explicit ask.**
- [x] **T-037** Client test for the tray + mastery colour mapping, so drift is caught without a browser.
      **Done** — `web/src/ui.test.ts`, 11 tests, run by `npm --prefix web test` and wired into the root
      `npm test` so it cannot be orphaned. Covers the one-row-per-id collapse and its winner rules, severity
      ordering, the five mastery states, the memory-strength "insufficient data" case and its monotonicity,
      `filterCourses`, and `mostRecent`. Pure logic moved to `web/src/select.ts` so it needs no browser.

## P9–P12 — recover the four features dropped in the P2 cutover

> Plan and the recovered source quotes: `.agent/plans/P9-P12-recover-dropped-features.md`.
> Source is `06cee66^:public/app.js`, not the audit.

- [x] **T-046** Grill-misconception dispatch (REDESIGN). **Done when:** clicking a misconception row or a
      concept name navigates to the lesson with the exact `/skill/grill-misconception <concept>` prompt
      seeded, dispatches it against the real bridge, and a reload does not re-send.
      **Done** — `web/src/grill.ts` (prompt, href, ask parsing) + a Grill action on every tray row and every
      SM-2 concept name. The href resolves the concept to ITS unit (react-state → 1, hooks → 2), which the
      derived model makes exact. The lesson seeds the composer so the learner sees what is asked on their
      behalf, dispatches once, then strips the parameter.
      **Browser-verified against the real bridge:** the click landed on unit 2 with a streamed reply and 7,754
      chars of reasoning in the drawer; the URL settled on the lesson (not the course); reloading it sent
      nothing (0 user messages).
      **Bug found while verifying:** the strip wrote the COURSE route, so the URL described a different screen
      than the one displayed — it only survived because `replaceState` does not re-route, and a refresh would
      have landed on the course page.
- [ ] **T-047** Sprint rest gate (PORT the mechanic, REDESIGN the visual). **Done when:** a gate token inside
      the stream freezes the composer, suppresses the rest of that turn, runs a 5:00 client-side countdown
      with no backend state, and unfreezes at zero.
- [ ] **T-048** Passivity intercept as a real gate (REDESIGN — behaviour change). **Done when:** after the
      tutor's `PASSIVITY` notify, a passive draft cannot be submitted, a real explanation can, and sending one
      clears the intercept.
- [ ] **T-049** Budapest mode as a structured `mode` on `POST /api/chat` (REDESIGN). **Done when:** with the
      toggle on, the modifier reaches the server's outgoing prompt while the posted message does not.
