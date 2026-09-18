# Learning event schema — `events.jsonl` v1

> Layer 1 of the three-layer learning store. Append-only and authoritative for telemetry;
> `SCHEMA.md` and `SESSIONS/*.md` are projections derived from it.
> Introduced in P0 (DEF-001 fix). Implemented in `~/.pi/agent/extensions/learning/`.

## Contract

- **Location:** `<course>/.agent/learning/events.jsonl`
- **Format:** one JSON object per line, LF-terminated, UTF-8. Append-only — never rewritten, never compacted.
- **`v`:** schema version, currently `1`. Bump only for a breaking field change; consumers must ignore unknown fields.
- **Malformed lines:** skipped by the parser and counted (the reader returns `{ events, malformed }`); a count is written to `telemetry-errors.log` as `reason=malformed-log-lines`. One bad line never fails the projection.
- **Replay:** `reduceEvents(events)` must be a pure function of the log. Projections *replace* the regions they own, so replaying the whole log any number of times yields byte-identical output.

## Envelope

Session-scoped events carry `session_id`, `session_file`, and `cwd` in addition to the common fields.

| Field | Type | Present on | Notes |
|---|---|---|---|
| `v` | number | all | schema version, `1` |
| `ts` | string | all | ISO-8601 UTC with milliseconds |
| `kind` | string | all | see the table below |
| `session_id` | string | all except legacy | pi session UUID |
| `session_file` | string \| null | all session-scoped | absolute path to pi's own transcript — layer 0 |
| `cwd` | string | all | course directory, so the log stays self-describing if it moves |

## `kind` → fields

| `kind` | Fields | Written by |
|---|---|---|
| `session_start` | — (envelope only) | hook, deterministic |
| `session_end` | `turns` | hook, deterministic |
| `badge` | `concept`, `to`, `status`, `source` | tutor (tool or tag) |
| `sm2` | `concept`, `sm2.{interval,ease_factor,repetitions}` | tutor |
| `misconception_open` | `concept`, `id`, `description`, `severity?` | tutor |
| `misconception_resolved` | `concept`, `id`, `corrected`, `severity?` | tutor |
| `note` | `concept`, `text` | tutor or user |
| `decision` | `concept`, `text` | tutor or user |
| `telemetry_missing` | `reason`, `evidence` | hook, deterministic |
| `assessment_result` | `unit`, `quiz_source`, `right`, `wrong`, `total`, `item_ids` | socrates-web |

Field notes:

- `status` duplicates `to` on `badge` events for readability. `to` is authoritative.
- `source` is `"tool"` (validated `record_learning` call) or `"tag"` (legacy `<learning-telemetry>` block).
- **`turns` on `session_end` counts USER PROMPTS, not agent turns.** One prompt can span several agent
  turns when tools run, so an agent-turn count reported `4` for a single exchange. Nothing consumes an
  agent-turn count, so it is not recorded at all.
- `note` and `decision` are the free-form journal: they project into `SESSIONS/<...>.md` and stay in the
  log permanently.
- **`assessment_result`** is written by **socrates-web**, not by the extension — the only place the web app
  writes into a course. It records a completed quiz attempt so the attempt is real history rather than a
  transient screen. It carries **no** `session_id` or `session_file`, because a quiz attempt happens outside
  a tutor session; consumers must not assume those fields are present.
  It is deliberately **not** consumed by any projection: nothing computes a mastery change from an attempt, so
  `POST /api/courses/:id/results` returns `mastery: null` and the completion screen claims nothing beyond the
  score and the fact of recording. When a projection does compute a mastery change, it should read this event
  rather than the log needing a rewrite.
- **`severity`** is tutor-emitted: `root` — core mental model is wrong · `partial` — right idea applied
  wrongly · `edge` — isolated slip, not a model flaw. It is **never inferred from the misconception
  prose**; an absent field means unrated. An omission on a later event does **not** clear a rating
  recorded earlier — only an explicit value overwrites it, which is how re-assessment works.
  `resolved` and `unrated` are *display* states derived from `status` + emptiness, so they are never
  stored:

  ```
  severityState = status === "resolved" ? "resolved" : (severity || "unrated")
  ```

  Colours (stroke, never fill — dot + label): `root` `#c83f3f` · `partial` `#d97706` · `edge` `#d4a72c`
  · `resolved` `#c9c6bd` · `unrated` neutral. This is a **shared format**: the extension projection
  (`schema.ts`) and socrates-web's `learning-parser.ts` both implement it and must land together.
  Prefer this table plus the optional derived signal (review cycles survived, see below) over any
  attempt to compute severity from text.

## Raw lines (from the P0 T-009 read-back)

Home-directory paths are abbreviated to `<user>`; everything else is verbatim output, including field order,
key order within nested objects, and the escape style JSON used on Windows paths.

```
{"v":1,"ts":"2026-09-13T07:31:45.772Z","kind":"session_start","session_id":"01a099ad-e4f5-7cd2-8fda-ec9be1e7a15d","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-31-45-525Z_01a099ad-e4f5-7cd2-8fda-ec9be1e7a15d.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback"}
{"v":1,"ts":"2026-09-13T07:31:47.535Z","kind":"session_end","session_id":"01a099ad-e4f5-7cd2-8fda-ec9be1e7a15d","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-31-45-525Z_01a099ad-e4f5-7cd2-8fda-ec9be1e7a15d.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback","turns":1}
{"v":1,"ts":"2026-09-13T07:32:02.134Z","kind":"telemetry_missing","session_id":"01a099ae-1bba-7aae-9cdf-bd038f278c7c","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-31-59-546Z_01a099ae-1bba-7aae-9cdf-bd038f278c7c.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback","reason":"grill-turn-without-telemetry","evidence":"grill-misconception"}
{"v":1,"ts":"2026-09-13T07:32:54.289Z","session_id":"01a099ae-e8c3-753f-b71f-728e1d89087c","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-32-52-035Z_01a099ae-e8c3-753f-b71f-728e1d89087c.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback","kind":"badge","concept":"react-state","to":"🟨","status":"🟨","source":"tool"}
{"v":1,"ts":"2026-09-13T07:32:54.289Z","session_id":"01a099ae-e8c3-753f-b71f-728e1d89087c","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-32-52-035Z_01a099ae-e8c3-753f-b71f-728e1d89087c.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback","kind":"sm2","concept":"react-state","sm2":{"interval":2,"ease_factor":2.5,"repetitions":1}}
{"v":1,"ts":"2026-09-13T07:32:54.289Z","session_id":"01a099ae-e8c3-753f-b71f-728e1d89087c","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-32-52-035Z_01a099ae-e8c3-753f-b71f-728e1d89087c.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback","kind":"misconception_open","concept":"react-state","id":"MIS-005","description":"believed setState mutates state synchronously"}
{"v":1,"ts":"2026-09-13T07:33:15.092Z","session_id":"01a099af-3a09-77e4-b6db-9a7adfd35226","session_file":"C:\\Users\\<user>\\.pi\\agent\\sessions\\--C--Users-<user>-AppData-Local-Temp-soc-readback--\\2026-09-13T07-33-12-841Z_01a099af-3a09-77e4-b6db-9a7adfd35226.jsonl","cwd":"C:\\Users\\<user>\\AppData\\Local\\Temp\\soc-readback","kind":"misconception_resolved","concept":"react-state","id":"MIS-005","corrected":"setState is asynchronous and batched, so both calls read the same snapshot"}
```

Note the field order on `badge` differs from `session_start` — field order is not part of the contract,
only presence and meaning are.

### Correction to an earlier note

A review note stated that `session_end` omits `session_file` and that consumers must merge by
`session_id`. That was inferred from an abbreviated excerpt in the read-back report, and it is not
accurate: **`session_end` does carry `session_file`** (see the raw line above). Merging by `session_id`
is still the recommended consumer approach — it is just not forced by a missing field.

## Consumer notes

- `session_end` closes the most recent open session, so events must be read in file order.
- Concurrency is single-writer-per-session by design. Two simultaneous sessions in one course dir append
  sequentially; a partial line is skipped and logged rather than corrupting the projection.
- Anything derived must be recomputable: if a projection looks wrong, delete it and re-run the projection
  from the log.

## Registry columns

Seven, in this order. The 7th (`Severity`) was added additively; a table with only six columns still
parses, and every row reads as `unrated`.

| # | Column | Owner | Notes |
|---|---|---|---|
| 1 | `ID` | log | `MIS-nnn`. Duplicates are reported (`duplicate-registry-row:<id>`), never auto-repaired. |
| 2 | `Concept` | log | must match a concept card name |
| 3 | `Misconception` | tutor | what the learner believed, as observed |
| 4 | `Corrected model` | tutor | the learner's own words, on resolution |
| 5 | `Status` | log | `open` \| `resolved` |
| 6 | `Date` | log | ISO date of the latest event |
| 7 | `Severity` | tutor | `root` \| `partial` \| `edge` \| blank (unrated) |

### Migration to 7 columns

The projection performs a **guarded, additive, one-shot** migration: only when the header is exactly the
known 6-column shape containing `Corrected model` and the separator has 6 cells. It appends ` Severity `
to the header, extends the separator, and pads existing rows with an empty cell. It never removes a
column and never rewrites cell contents, and it reports `registry-migrated-to-7-columns` in warnings.

## Publication rule — the log must never be published

`events.jsonl` embeds **absolute paths** (`cwd`, `session_file`), and those embed the OS username. It is a
private runtime artifact, not documentation.

Any repo hosting a course — especially a public one — must ignore the runtime artifacts:

```gitignore
.agent/learning/events.jsonl
.agent/learning/SESSIONS/
.agent/learning/telemetry-errors.log
```

The source-of-truth files are path-free and safe to commit: `MISSION.md`, `PLAN.md`, `SCHEMA.md`.

**Applied:** a sample course repo (public, name redacted). It previously ignored only `.agent/telemetry*`, so `events.jsonl`
and `SESSIONS/` — the two files that carry the account name in every `session_file` — were one `git add .`
away from publication. Verified after the fix: all three artifacts ignored, and `MISSION.md` / `PLAN.md` /
`SCHEMA.md` still committable. Nothing was published, so no history rewrite was needed.

Why this matters beyond tidiness: a published log leaks the account name and the local directory layout, and
scrubbing after a push does not remove it from history.

## Manual dedupe procedure (misconception registry)

The projection **never deletes a registry row**. A row with an id it already knows is updated in place; rows
it does not know about are treated as authored content and left alone. Pre-existing duplicates therefore do
not self-heal — a `duplicate-registry-row:<id>` warning is reported instead (visible in
`telemetry-errors.log` as `reason=projection-warnings`).

There is deliberately **no automated repair**: a duplicate row is indistinguishable from an authored row by
id alone, so automated deletion is the one operation that can destroy real content. Dedupe manually:

1. Find duplicates:
   `grep -oE '^\| MIS-[0-9]+ ' .agent/learning/SCHEMA.md | sort | uniq -c | awk '$1 > 1'`
2. For each flagged id, read the rows in section 3 and keep the one whose `Corrected model` cell is most
   complete — or the newest date if none is filled.
3. Delete the other rows **by hand** in the editor.
4. Re-run the projection (any `record_learning` call, or the next `session_end`) and confirm the warning is
   gone.
5. The log is untouched by this — `events.jsonl` may legitimately contain several events for one id. That is
   history, not duplication; only the registry table is deduped.
