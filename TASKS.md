# Socrates-Web — Task Tracker

> Status: `[ ]` todo · `[x]` done. Stop after each phase for review.
> Phase order and rationale: `PLAN.md`. Decisions: `DECISIONS.md`. Design resolutions:
> `.agent/grill/socrates-persistence-and-cutover.md`.
>
> **`[x]` is history, not current behaviour.** P16 (a course is a subject, not a folder) DELETED some
> tasks marked done here, whose code is no longer in the tree: **T-011**'s `kind`, **T-013**, **T-014**'s
> scan/registry routes, **T-041** and **T-044**. Each carries an inline note at its own entry; the
> supersede record for the decisions behind them is in `DECISIONS.md`.

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
      **PARTLY REMOVED (P16):** the `kind` field is gone with the codebase kind. Lesson groups, module
      order and module types remain.
      **Done when:** a manifest overrides the derived tree and `manifest > derived` precedence is tested.
      **Done** — `parseCourseManifest()`; a malformed manifest falls back to the derivation with
      `manifest-invalid:<reason>` instead of producing a half-built tree. `@concept` refs attach mastery;
      a dangling ref is preserved with `missing: true` + `unknown-lesson:<name>`.
- [x] **T-012** 5-state mastery map (badge → state / colour / ring) as a single exported union; no sixth state.
      **Done when:** a test asserts every badge maps, and an unknown badge renders `Not started` + warning.
      **Done** — `MASTERY_BY_BADGE` / `masteryOf` / `aggregateMastery` / `countByMastery`; exactly five states
      asserted, unknown badge reads Not started, aggregate never divides by zero.
- [x] ~~**T-013** `courses.ts` — `COURSES_ROOT` scan (one level), `.agent/courses.json` overlay~~
      **REMOVED (P16):** `courses.ts` and its tests are deleted; the store replaces them. Kept as history.
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
- [x] ~~**T-041** A "start a course" affordance.~~
      **REMOVED (P16):** the not-initiated list it attached to is gone, and writing `MISSION.md` into a
      project directory is superseded by `POST /api/courses { subject }` + the scaffold interview.
      **Done** — each not-initiated entry in "Add or manage" now offers **Start course**, which opens a small
      form and writes `MISSION.md` from the user's OWN words (destination required; artifact optional). The
      scaffold skill can enrich the rest of the mission later. It never overwrites an existing mission, an
      unanswered field is written as `<fill in later>` rather than fabricated, and the course appears in the
      catalogue immediately.
      **Browser-verified:** catalogue went from 1 course to 2, the new card is titled from the typed
      destination, the submit button stays disabled until the destination is non-empty, and the file on disk
      carries the typed words with `<fill in later>` for the blank field. 2 unit tests cover the refusals
      (empty destination, no learning dir, already initiated).
- [x] ~~**T-044** A UI-started course has `MISSION.md` only, so it renders **0 units** until the scaffold
      skill writes `PLAN.md`/`SCHEMA.md`. That is correct, but from the catalogue it looks broken.~~
      **REMOVED (P16):** its "started, but not scaffolded" copy covered a course that had been *found*
      rather than started. A course now begins at the interview, and the empty-*library* state names the
      next action instead (see the empty-state copy in `HomePage.tsx`). Kept as history.
      **Done** — the catalogue card reads "Started, but not scaffolded yet — the tutor writes the concept cards
      with you" with the footer "Not scaffolded yet" instead of "0 units"; the unit rail says there are no units
      and offers the path; the pane explains WHY (units are derived from concept cards), says this is a normal
      state rather than a broken one, and offers **Scaffold this course with the tutor**. That dispatches
      `/skill:scaffold-learning` through the SAME ask mechanism as the grill (`askHref`), so there is one way a
      click starts a session rather than two.
      **Browser-verified end to end:** the card, rail and pane all say so; the action lands on the lesson with
      the prompt dispatched and visible as the learner's own turn; the tutor begins the interview.
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
      concept name navigates to the lesson with the exact `/skill:grill-misconception <concept>` prompt
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
- [x] **T-047** Sprint rest gate (PORT the mechanic, REDESIGN the visual). **Done when:** a gate token inside
      the stream freezes the composer, suppresses the rest of that turn, runs a 5:00 client-side countdown
      with no backend state, and unfreezes at zero.
      **Done** — `web/src/restgate.ts` (the three tokens, `splitAtGate`, `formatCountdown`, `isFrozen`) plus the
      gate in `LessonPage`. Mechanic ported: same tokens, same "everything from the token onward is suppressed",
      same frozen composer, same 5:00 client-side countdown, no backend state. Visual REDESIGNED to the app's
      existing dialog treatment — the original `rgba(17,17,17,0.55)` overlay is not reproduced and **no
      `backdrop-filter` was added** (it never had one). Copy ported verbatim.
      **Browser-verified with a real turn:** the token opened the gate, the token did NOT appear in the prose,
      the composer was disabled with the button reading "Resting…", the countdown ran 04:08 → 03:59 → 03:56 →
      03:54 at one second per tick, and **after it expired the gate closed and the composer re-enabled** (waited
      out in full rather than inferred).
      **Robustness fix:** the original tested each `text_delta` in isolation, so a token split across two chunks
      was missed. Detection now runs over the accumulated prose; a test covers the straddling case.
- [x] **T-048** Passivity intercept as a real gate (REDESIGN — behaviour change). **Done when:** after the
      tutor's `PASSIVITY` notify, a passive draft cannot be submitted, a real explanation can, and sending one
      clears the intercept.
      **Done** — `web/src/passivity.ts` with `PASSIVE_RE` ported verbatim and the banner copy verbatim. Trigger
      PORTED (the tutor's notify; the client never diagnoses passivity). Gate REDESIGNED and labelled in the UI
      as a change: with the intercept active a passive draft cannot be sent. 5 tests.
      **Browser-verified** with a mock producer for the notification (no such extension is installed here, so
      the frame is generated deterministically): banner appears on the tutor's signal → "ok" leaves the button
      disabled reading "Explain it" → a real explanation enables "Send" → sending clears the intercept and the
      next turn streams.
- [x] **T-050** The lesson console never renders the learner's own message. The original did —
      `append("user", message)` at `06cee66^:public/app.js:181` — and the handoff specifies learner turns as
      high-contrast and right-aligned. Found while verifying T-048 (a sent explanation left no visible trace).
      **Done** — `web/src/transcript.ts` (pure `appendUser` / `settleAssistant`, gate-aware) plus the console
      rendering settled turns before the live one. Learner turns use the handoff's treatment: ink background,
      paper text, 8px radius, max 80% width, right-aligned.
      **Browser-verified on the real bridge:** the learner's message appeared immediately, before any reply;
      the tutor's reply settled into the transcript rather than vanishing; and two exchanges accumulated in
      order (2 learner + 2 tutor).
      **Bug found while verifying:** the first attempt settled the turn by reading React state through a ref
      mirrored by an effect — stale when the settle frame arrived with the last delta, so it settled an EMPTY
      turn and the tutor's reply vanished entirely. Prose is now accumulated synchronously in the stream
      handler.
- [x] **T-049** Budapest mode as a structured `mode` on `POST /api/chat` (REDESIGN). **Done when:** with the
      toggle on, the modifier reaches the server's outgoing prompt while the posted message does not.
      **Done** — `BUDAPEST_MODIFIER` ported verbatim into `server.ts`; the client sends `mode` and the SERVER
      injects. A global toggle in the top bar, as the original header checkbox was.
      **Browser-verified:** the default request body is `{message, course, mode:"default"}` and the Budapest body
      is `{message:"what is state?", mode:"budapest"}` with the message untouched (`polluted: false`); the server
      answers `mode: "budapest"`. **Server-verified** that the modifier really is injected, by a mock that echoes
      the prompt the bridge was handed — 3 tests, including "any other mode value is treated as the default".
      **Wording deliberately unchanged:** it is programming-specific, and rewriting it would be a content
      decision rather than a recovery.

## T-051 — CLOSED as a misdiagnosis: nothing was lost

**Status:** closed 2026-09-13. No defect found; no fix made.

**What was claimed.** That a long tool-heavy turn rendered its prose and then never settled: the
composer disabled forever, no tokens for later turns, reload not recovering, while the server
reported `accepted:true / killedTurn:false` — and that the loss was in the `/api/stream` handshake.

**What the instrument showed.** Per-turn handshake logging (ACCEPT / SUBSCRIBE / ATTACH / SETTLE /
CLOSE, with turn ids, millisecond timestamps and the subscriber tag) on one long tool-heavy turn:

```
[hs t1 21:57:52.776] ACCEPT course=… priorSubscriber=none
[hs t1 21:57:52.781] SUBSCRIBE s1 accepted — settled=false, replaying 0 line(s)
[hs t1 21:57:52.781] ATTACH s1 as the live subscriber
[hs t1 21:58:06.735] SETTLE kind=done alreadySettled=false subscriber=s1 bufferedLines=1379
[hs t1 21:58:06.735] CLOSE s1 (was not the live subscriber)
```

`SETTLE … subscriber=s1` is the server writing `[DONE]` **to the live subscriber**. The 429 branch
never fired and no frame was lost. A second turn behaved identically (`t2`, `s2`), and its reply
rendered.

**The three measurement errors, all mine.**
1. **`disabled` was read as "busy".** The Send button is `disabled={!canSend}` where
   `canSend = maySubmit(intercept, input) && !busy && !frozen`, so an empty textarea disables it. Its
   *label* — `busy ? "Waiting…" : … "Send"` — said `Send` the whole time, i.e. `busy === false`.
   One attribute was treated as the state; the label that actually names the state was ignored.
2. **`document.querySelector(".prose")` returns the FIRST match.** After turn 1 settled into the
   transcript there were two `.prose` elements, so "prose frozen at 1396 characters" was turn 1's
   message being read over and over. Turn 2's reply was in the second element and rendering fine.
3. **A turn started by `curl` has no UI subscriber.** The server accepts it, but the browser only
   opens `/api/stream` when the *page* sends, so "no tokens for a later accepted turn" was expected
   behaviour, not a lost frame.

**Kept:** the handshake logging. It is five lines per chat turn, carries no message content and no
paths, and it is what turned a confident two-session diagnosis into a disproved one. A future
handshake question should start by reading it.

## P17 — Human-readable names (no identifier reaches the UI)

- [x] **T-052** `humanize()` — one pure function in `web/src/humanize.ts`: split on `-` and `_`,
      capitalise each word, join with spaces; idempotent on text that is already human; no acronym
      dictionary.
      **Done when:** tests cover a slug, a snake_case name, an already-human name (unchanged), an
      acronym slug (`kpi` → `Kpi`, documented as the known limitation), and empty/whitespace input.
      **REVISED (follow-up):** the convention is SENTENCE CASE, not Title Case. One test decides
      everything — a `-` or `_` means the string is an identifier, so lowercase it and capitalise only
      the first word (`e46-drift-target-spec` → `E46 drift target spec`); no separator means it is text
      someone wrote, returned unchanged. Title-casing every chunk capitalised connectives
      (`Bump Steer And Roll Centre`), the tell of a machine, and it read differently from a fresh
      scaffold in the same library. No connective rules — that is the dictionary trap in another shape.
      **REVISED AGAIN (follow-up):** back to TITLE CASE, applied to identifiers AND authored text, so a
      course whose headings predate the convention does not read differently from one scaffolded after it.
      Word-level, not blunt: a word with an uppercase letter after its first character is deliberate and is
      left alone (`useState`, `iPhone`, `KPI`, `E46`), everything else is capitalised and lowercased
      (`kpi` → `Kpi`). No acronym dictionary and no small-word list for connectives — `And` is capitalised
      like any word, and proper title case is a separate decision if it is ever wanted.

      **Two consequences, recorded not papered over:** a SINGLE-WORD slug has no separator and so is
      left exactly as written (`kpi` stays `kpi`), and an authored name containing a hyphen loses it
      (`front-toe` → `Front toe`) — which is why the skill now says to keep hyphens and underscores out
      of card headings and use spaces. The fix for casing is authoring, not cleverness.
- [x] **T-053** The scaffold skill authors HUMAN concept headings, and the SCHEMA template shows a human
      placeholder rather than `<concept-name>`.
      **Done when:** the skill's Step 6 states the heading is the NAME and the slug is derived, with the
      reason (a slugger destroys `KPI`/`E46`); the template's example heading is human words.
- [x] **T-054** Apply `humanize` at every render site that prints a concept or unit name: the rail, the
      unit heading, the breadcrumb, the derived module titles, the group heading, the missing-card note,
      the tray rows and their grill labels, the telemetry table cells and links, the journal and
      continue-strip "covered" lists, and the quiz/lab unit titles.
      **Done when:** a course whose SCHEMA.md holds slug names renders human text everywhere, verified
      by a test over the model-built strings and in the browser.
- [x] **T-055** Browser verification on a real unit: no lowercase-dashed string anywhere on the page.
      **Done when:** the rail, breadcrumb, heading, module titles, tray and telemetry table are pasted
      in the report showing human text.
      **Done** — verified on the owner's own `string-box-alignments`, whose SCHEMA.md holds slug card
      names: rail/table read "Suspension Angle Vocabulary · E46 Drift Target Spec · …", the breadcrumb
      "All courses › String Box Alignments › Unit 1", the heading "Unit 1: Suspension Angle
      Vocabulary", modules "Recite Suspension Angle Vocabulary", the tray "Grill Camber Measurement And
      Adjustment". A full-page scan for `[a-z0-9]+(-[a-z0-9]+)+` returns only a date and a hyphenated
      English phrase inside authored prose. The journal and continue strip were verified the same way in
      a throwaway store (the owner's sessions record no covered concepts): "Covered Wheel Anatomy And
      Tension Model, E46 Drift Target Spec".

- [x] **T-056** The derived module titles drop the leading verb, because the row already renders the type
      label beneath them: `Recite X` / `Review X` → `X`, and `Explain X in your own words` keeps its
      qualifier (it is what distinguishes free recall from a review). `Misconceptions (N)` is untouched.
      **Done when:** the three titles are asserted, `Misconceptions (N)` is asserted unchanged, no
      verb-stripped title repeats its own type label, and the three accessible names differ — the visible
      distinction is the label *beneath*, and a screen reader has no beneath, so `moduleRingLabel` folds
      the type back in for `aria-label` only.
      **Done** — 136 server (up from 134) + 98 client (up from 96).

## T-057 — `telemetry_missing` fires on a grill turn that had nothing to record

**Status:** open, reproduced on a real grill turn 2026-09-14. Found by D7's full-loop acceptance.

**Symptom.** A grill turn that is still probing records
`{"kind":"telemetry_missing","reason":"grill-turn-without-telemetry"}` and a
`telemetry-errors.log` entry, even though nothing was wrong.

**Evidence.**
- The shipped learning extension decides on `agent_end`: if no telemetry arrived this turn AND
  `detectGrillTurn()` is true, it records the gap (`pi/extensions/learning/index.ts:245-260`).
- `detectGrillTurn` is true whenever the last user message contains `<skill name="grill-misconception"`
  (`pi/extensions/learning/signal.ts:56-63`) — i.e. for EVERY grill turn.
- The skill instructs the opposite: emit a block "when — and only when — a concept's proficiency changes,
  or a misconception is detected or resolved… If nothing changed, emit no block at all."
- Observed on four consecutive grill exchanges: the tutor probed the learner's wrong model (correct
  behaviour), never delivered a verdict, emitted no block — and the log recorded a gap on each.
- The pipeline itself is fine: a compliant reply parses and validates
  (`blocks found: 1`, `validated: Tension 🟨`) via `extractTelemetry` + `validateTelemetry`.

**Why it matters.** The signal is the only way to detect a genuinely broken pipeline, and it fires on
normal operation, so it cannot be trusted. It also writes a warning into the learner's course directory
for nothing.

**Fix direction (not built).** Either narrow the trigger — record the gap only when the grill turn
CONCLUDED (a verdict was reached) and still emitted nothing — or have the skill emit a no-op marker on a
probing turn. The first is better: the second trains the model to emit blocks that say nothing.

## T-058 — `feynman-recite` is served in NO configuration

**Status:** open. CORRECTED 2026-09-14 during the audit round: the original description was stale and
would have sent someone chasing a call path that no longer exists. What changed and what did not is
recorded below rather than silently edited.

**Symptom (corrected).** `feynman-recite` is not available to the tutor. It is a PACKAGING GAP, not a
loading mystery: the skill was never shipped in `pi/skills/`, so there is nothing for pi to load.

**Evidence (verified this round).**
- `ls pi/skills/` -> `skill-grill-misconception.md`, `skill-scaffold-learning.md`. Only two.
- `ls -A ~/.socrates/pi/skills/` -> the same two. The runtime home is materialised from the repo, so a
  skill absent from the repo cannot appear at runtime.
- The earlier spike's multi-configuration comparison (`--skill <dir>`, three `--skill <file>` flags, the
  real harness) is now explained by the simplest possible cause: the file was never in the set.

**The stale claim, for the record.** The original text said "the lesson dispatches
`/skill:feynman-recite`, which resolves to nothing". That was true when written and is true no longer:
`moduleAskHref` (`web/src/grill.ts`) routes Recite and Explain to `grill-misconception` instead, precisely
because this skill is unavailable. The only remaining reference is a comment at `web/src/grill.ts:85`
explaining that choice. Nothing dispatches `feynman-recite` today.

**Evidence (spike, real spawned children).**
- The real harness served **10 skills**; `feynman-recite` was not among them.
- An app-owned config dir with all three skill files present served **2 skills** (`scaffold-learning`,
  `grill-misconception`).
- Three explicit `--skill <file>` flags naming it, and `--skill <dir>` covering its directory, both served
  the same two skills — it appeared in NONE of the configurations tried.
- Its frontmatter is well-formed and does NOT set `disable-model-invocation`, so the exclusion is not the
  same mechanism that hides `scaffold-learning` from model self-selection.

**Consequence for this app.** `web/src/components/CoursePage.tsx:20` lists `recite` in
`TUTOR_MODULE_TYPES`, so the module row opens the lesson — and the lesson dispatches
`/skill:feynman-recite`, which resolves to nothing. The visible effect is a lesson whose tutor has no
instructions for the task it was asked to run.

**Fix direction (corrected).** Either ship the skill in `pi/skills/` and point `moduleAskHref`'s `recite`
case back at it, or delete the dead reference and keep the grill substitution permanently. The first is a
packaging change; the second is a one-line deletion plus a comment update. Both are cheap — the expensive
part was believing there was a loading mechanism to debug.
