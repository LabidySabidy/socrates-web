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
- [ ] **T-010** `course-model.ts` — derivation (unit = concept card) returning `{ tree, warnings[] }` with all
      seven edge cases from the grill doc. **Done when:** tests cover 0 concepts, missing SCHEMA.md, missing
      MISSION.md, duplicate concept names, unknown badge, and a `COURSE.md` naming a nonexistent card.
- [ ] **T-011** `COURSE.md` override parser (lesson groups, module order/types, assessment placement, `kind`).
      **Done when:** a manifest overrides the derived tree and `manifest > derived` precedence is tested.
- [ ] **T-012** 5-state mastery map (badge → state / colour / ring) as a single exported union; no sixth state.
      **Done when:** a test asserts every badge maps, and an unknown badge renders `Not started` + warning.
- [ ] **T-013** `courses.ts` — `COURSES_ROOT` scan (one level), `.agent/courses.json` overlay
      (pin / order / label / hide / add), ignore list. **Done when:** tests cover scan discovery, hide, pin order,
      and a registry entry outside the scan root.
- [ ] **T-014** Routes: `GET /api/courses`, `GET /api/courses/:id`, `GET /api/courses/:id/learning`,
      `POST /api/courses`; `/api/learning` unchanged as an alias. **Done when:** an alias-shape test proves the
      old response is byte-compatible.
- [ ] **T-015** Watcher covers N courses. **Done when:** editing SCHEMA.md in a non-default course pushes a
      `reload` event for that course only.
- [ ] **T-016** `docs/CONTENT-MODEL.md` — the derivation rules and the warnings table. **Done when:** it matches
      `course-model.ts` exactly (checked by reading both).
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
- [ ] **T-017** `web/` Vite + React + TS scaffold, dev proxy `/api` → Node, tokens as CSS custom properties,
      self-hosted-or-fallback fonts. **Done when:** `tsc --noEmit` and `vite build` are clean.
- [ ] **T-018** Hash router + app shell (top bar, emblem, wordmark). **Done when:** routes round-trip and
      back/forward work.
- [ ] **T-019** Course page: unit rail (mastery rings, `aria-current`, course switcher) + module pane
      (lesson groups, module rows, type icons) from real data. **Done when:** browser-verified against a real course.
- [ ] **T-020** Home catalogue (greeting, continue strip, mastery counts, course grid) from real data.
      **Done when:** browser-verified; no fabricated percentage anywhere.
- [ ] **T-021** Telemetry rail: SM-2 panel, misconception tray, "Memory strength (SM-2 estimate)" with an
      "insufficient data" state. **Done when:** browser-verified; every number traces to a real field.
- [ ] **T-033** Misconception tray renders **one row per id**, never duplicates. Dot + label by
      `severityState`, colour as stroke: root `#c83f3f` · partial `#d97706` · edge `#d4a72c` ·
      resolved `#c9c6bd` · unrated neutral. No counts, no repeated beliefs.
      **Done when:** browser-verified against a course whose registry holds duplicate ids (the fixture has
      `MIS-003` ×3) and the tray shows one row; the backend duplicate warning is still emitted but not shown.
- [x] **T-022** **Gateway:** confirm the sparser Home (no streaks / levels / ep / badge discs / subject chips) is
      wanted. **Done when:** the user confirms in writing; if not, the scope is updated before T-023.
      **CONFIRMED in writing 2026-09-13** — ship the sparser Home. Every number shown must have a backing field;
      "Continue where you left off" is backed only by the session journal.
- [ ] **T-023** Cutover, **last action of the phase**: serve `web/dist`, delete `public/`, delete the
      `/api/learning` alias — one commit, so a single `git revert` restores the old UI.
      **Done when:** the new UI is browser-verified end to end *before* the deletion, and afterwards `npm start`
      serves it from `web/dist`.

## P3 — Add-a-course
- [ ] **T-024** "Add course" form → `POST /api/courses`; hide/ignore affordances; no-results state.
      **Done when:** browser-verified — an added course survives a restart; hiding removes it without touching disk.

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
