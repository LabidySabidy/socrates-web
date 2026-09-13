# Content model — Course → Units → Lessons → Modules

> Implemented in `course-model.ts` (derivation + manifest) and `courses.ts` (discovery).
> Precedence: **`COURSE.md` manifest > derived tree**.
> Every rule here is covered by `course-model.test.ts` against vendored fixtures in
> `test/fixtures/` — no test depends on an external project existing.

## Why the derivation looks like this

The handoff's IA is Course → Units → Lessons → Modules, but the real content on disk is
`MISSION.md` / `PLAN.md` / `SCHEMA.md`. Spike evidence decided the mapping:

- **Deriving units from PLAN roadmap phases was tested and failed.** Prose-matching phase text against
  concept names recovered 2 of 5 concepts in one real project, mapped a whole phase to nothing, and
  returned 0 of 4 in a second project that has no roadmap section at all.
- **Deriving units from concept cards works everywhere**, exactly, with zero invented data: the concept
  card is the only structure that is universally present, uniquely named, and already carries mastery.

So: one unit per concept card. Phases are course *context*, never units.

## Derivation rules

| Level | Derived from | Rule |
|---|---|---|
| Course | the course directory | `id` = directory basename; `title` = MISSION "I will be able to" → manifest `title` → directory name |
| Unit | one per SCHEMA.md concept card, in file order | `title` = card name; `mastery` = the card's badge via the five-state map; `n` = 1-based index |
| Lesson | the concept card itself | definition, connections, SM-2 telemetry, misconceptions |
| Module | derived study actions per card | `recite`, `review` (carries `due`), `explain`, and `misconceptions` **only when** the card has at least one misconception row |
| Mastery aggregate | mean of member ring fractions | snapped to the nearest of the five states; empty set → Not started |
| Course context | MISSION + PLAN | surfaced as `mission` and `plan` (`sequence`, `cutList`) — never as units |

Duplicate concept names collapse to the **first** card, with a warning. The writer can only ever
reach the first card, so silently splitting state between two headings is the failure mode being
avoided.

## Mastery — exactly five states

| Badge | State | Colour | Ring |
|---|---|---|---|
| `⬜` | Not started | `#c9c6bd` | 0 |
| `🟥` | Attempted | `#d97706` | 0.25 |
| `🟨` | Familiar | `#4a6fa5` | 0.50 |
| `🟩` | Proficient | `#2d7a4c` | 0.78 |
| `🟦` | Mastered | `#14462c` | 1.00 |

A sixth state is never correct. Anything outside the union — including a missing badge — reads
Not started, and a heading whose glyph is outside the union raises `unknown-badge:<name>`.

## Warnings

Derivation never throws. Degenerate input produces a renderable tree **plus** a warning, because a
broken rail is worse than an honest empty state. Warnings are returned by the API and must be
surfaced in the UI, not swallowed.

| Warning | Trigger | Behaviour |
|---|---|---|
| `no-schema` | `SCHEMA.md` absent | mission still renders; units empty |
| `no-mission` | `MISSION.md` absent | title falls back to the directory name |
| `no-concepts` | zero concept cards | empty unit rail with an explicit empty state |
| `duplicate-concept:<slug>` | two cards share a name | first card authoritative; one unit, not two |
| `unknown-badge:<name>` | heading glyph outside the five-state union | that card is not a concept |
| `manifest-invalid:<reason>` | `COURSE.md` fails to parse | **derivation is used**; a half-built tree is never produced |
| `unknown-lesson:<name>` | manifest references a nonexistent card | reference preserved with `missing: true`; never invented |
| `manifest-duplicate:<title>` | two manifest units share a title | both kept; the collision is reported |

Discovery adds its own: `courses-root-missing`, `courses-root-unreadable:<dir>`,
`registry-invalid:<reason>`, `registry-dir-not-a-course:<dir>`, `duplicate-course-id:<id>`.

## `COURSE.md` manifest grammar

Deliberately tiny and line-oriented, so an invalid manifest fails loudly rather than producing a
half-built tree.

```markdown
```yaml
kind: codebase        # optional: topic (default) | codebase
title: Authored title # optional: overrides the mission destination
```

## Unit 1: Authored Unit

> Optional unit blurb (the first `> ` line after the unit heading).

### Group: Group name

- **Module** (`article`) Free-text title
- **Module** (`recite`) @concept-slug Title text
- **Quiz** 3 items
```

| Line | Meaning |
|---|---|
| `## Unit <n>: <title>` | starts a unit; `<n>` becomes `unit.n` |
| `> <blurb>` | first blurb line after a unit heading sets `unit.blurb` |
| `### Group: <title>` | lesson group; a group is opened implicitly as `Lessons` or `Assessment` if modules appear first |
| `- **Module** (`type`) <title>` | module; `type` must be in the module taxonomy or the manifest is rejected |
| `- **Module** (`type`) <title> @concept-slug` | attaches the concept's badge, mastery, and `due`; an unknown slug sets `missing: true` and warns |
| `- **Quiz** <n> items` | assessment placement with an item count |

An authored unit's mastery follows from the concepts it references, so a manifest never has to
invent a mastery value. A manifest unit referencing nothing real reads Not started.

## Module taxonomy

- **Derived:** `recite`, `review`, `explain`, `misconceptions`
- **Authored (manifest or generator):** `article`, `video`, `practice`, `quiz`, `test`, `interact`,
  `game`, `project`

Any other type string in a manifest is rejected with `unknown module type: <type>`.

## The grading contract (P8)

An auto-graded answer is only fair when a learner can be expected to reproduce it: a value, a term, a
number, an identifier. So an item carries a `mode`:

| `mode` | Behaviour | Requires |
|---|---|---|
| `short-answer` (default) | compared against the answer and its `accepts`, normalised | answer **≤ 6 words**, **≤ 60 chars**, and not more than one sentence |
| `self-check` | the worked solution is revealed and **the learner judges their own answer**; never auto-marked | nothing beyond hints and steps |

**Why the limits exist.** A paraphrase of a long answer cannot be checked against a list of accepted
phrasings, so it is marked wrong — a **false negative**, which is worse than a false positive in a
learning tool because it punishes a learner who was right. An item that needs prose must declare
`self-check`; if it does not, validation **rejects** it with
`answer-too-long-for-auto-grading:<words>-words-<chars>-chars-use-self-check`.

An authored item obeys exactly the same rule as a generated one: a long answer without
`- **mode:** self-check` is dropped with that warning, and so is a generated one.

**Normalisation** (`normaliseAnswer`) folds unicode form, curly quotes and dashes, case, repeated
whitespace, a wrapping pair of quotes/brackets, and trailing sentence punctuation — so `SELECT.`,
`"select"` and `  select  ` all match `select`. Internal punctuation is **kept**: `status = 'approved'`
and `status approved` are different answers, and a normaliser that accepted both would trade a false
negative for a false positive.

**One verdict per self-check item.** The solution has been revealed, so re-judging is meaningless.
The consequence, which is deliberate: the per-item mastery gate cannot open on a self-check item. A
wrong verdict still counts toward the attempt's total, which is what the mastery mapping reads.

## An attempt → mastery mapping (T-043)

The only statement of a quiz-to-mastery relationship anywhere in this project is the design
reference's mastery-gate copy:

> "You can no longer reach 'Proficient' on this attempt. You can keep going or start over. Start over
> is available after two mistakes."

So the rule says exactly what that says, and nothing more (`awardedBadge` in `assessments.ts`):

| Attempt | Qualifies the concept for |
|---|---|
| fewer than two mistakes | **Proficient** (`🟩`) |
| two or more mistakes | **Familiar** (`🟨`) |

Four constraints, each deliberate:

1. **It never awards Mastered.** A quiz is weaker evidence than a tutor's judgement, and nothing in
   this project licenses an attempt to award the top of the five-state scale.
2. **It is raise-only** (`raisesBadge`). An attempt never lowers a badge it finds.
3. **It only applies when the unit maps to exactly one concept.** The derived model is one unit per
   concept card; an authored unit that references several concepts has no single badge to move.
4. **It writes a `badge` event, not the file.** socrates-web does not run the extension's projection,
   so it logs the award in the extension's own vocabulary and the extension's existing projection
   applies it. That happens on that course's next tutor session.

Because of (4), `POST /api/courses/:id/results` returns `mastery: null` — the file has not moved —
plus `pendingBadge: { concept, badge, state }`. The completion screen reports the qualification and
the deferral: *"This attempt qualifies <concept> for Proficient. The badge updates the next time a
tutor session runs in this course."* It never claims a badge moved.

**SM-2 is deliberately untouched.** An SM-2 interval is a function of the previous interval and ease
factor, and no such rule is defined anywhere in this project for a quiz attempt — the tutor's
telemetry owns those fields. Inventing one here would be a fabricated scheduling rule.

## Discovery — scan first, registry overlay

1. **Scan** `COURSES_ROOT` (default: the parent of `PROJECT_DIR`) **one level deep** for
   `*/.agent/learning`. The default course itself is always included. Zero config.
2. **Registry** (`.agent/courses.json`) may pin (`order`), label, hide, or add courses outside the
   scan root, and carries an `ignore` list of directory names or paths.

Metadata precedence: registry entry > mission destination > directory name. `hidden: true` removes a
course from the catalogue without touching disk. Duplicate directory basenames are disambiguated
(`Dup`, `Dup-2`) with a warning — never silently merged.

## API

```
GET  /api/courses                -> { root, registry, warnings, courses[] }
GET  /api/courses/:id            -> CourseTree
GET  /api/courses/:id/learning   -> raw LearningData
POST /api/courses                -> { dir, action?: register|unregister|hide|unhide, label?, order? }
GET  /api/learning               -> ALIAS for the default course; shape unchanged
```

`POST` refuses a directory that is not a course (`not a course directory (no .agent/learning)`).
Unregister edits the registry only — the course on disk is never touched.

### `unregister` vs `hide` — they are not the same thing

| Action | Effect | Reversible |
|---|---|---|
| `unregister` | removes the **registry entry**. A course living under `COURSES_ROOT` is then re-found by the scan. | re-register |
| `hide` | sets `hidden: true` / adds to `ignore`, so it leaves the **catalogue**. | `unhide` |

So "remove this course from the list" is `hide`, not `unregister`. When `unregister` leaves a course still
discoverable by the scan, the response includes `stillDiscovered: true` and a `hint` — the client should offer
`hide` rather than appear to have done nothing.
