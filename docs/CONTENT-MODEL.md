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
