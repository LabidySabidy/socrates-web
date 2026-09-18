# socrates-web

A local web app that renders a **Socratic tutor** over a course you keep on disk. It reads a course's
learning files, turns them into units and lessons, drives a real tutoring conversation through
[pi](https://github.com/badlogic/pi-mono), and writes what you learned back to the course.

There is no account, no server to deploy, and no database. Your course is a directory; your progress is
that directory's files.

## Why it looks like this

Most "AI tutor" apps treat your content as an upload. This one treats it as a **collaboratively edited
document**: the tutor reads `MISSION.md` / `PLAN.md` / `SCHEMA.md`, and writes back mastery badges,
misconception records and spaced-repetition state. The files are the state — you can read them, diff them,
edit them, or version them with git.

## How a course is laid out

A course lives at `~/.socrates/courses/<slug>/.agent/learning/` (override the root with `SOCRATES_HOME`):

```
.agent/learning/
  MISSION.md      what the learner is trying to be able to do
  PLAN.md         the roadmap / sequence
  SCHEMA.md       concept cards: definitions, connections, mastery badges, misconceptions
  SESSIONS/       one record per closed tutoring session (with transcript)
  events.jsonl    append-only telemetry (badges, SM-2, misconceptions) — runtime data
```

The UI's structure is **derived** from those files, never invented:

| Level | Derived from |
|---|---|
| Course | the course directory + `MISSION.md` |
| Unit | **one per `SCHEMA.md` concept card** (in file order) |
| Lesson | the concept card itself — definition, connections, telemetry, misconceptions |
| Module | study actions per card: `recite`, `review`, `explain`, `misconceptions` |

Mastery has exactly **five states** (`⬜` not started → 🟩 mastered), and the badge in `SCHEMA.md` is the
source of truth. Full rules: [`docs/CONTENT-MODEL.md`](docs/CONTENT-MODEL.md).

## Running it

Requires **Node 24+** (the server and client are run as TypeScript directly — Node strips types; there is
no build step for the back end).

```bash
npm install
npm --prefix web install

npm run build        # build the UI into web/dist (npm start serves it)
npm start            # API + UI on http://localhost:3850

npm run dev:api      # API only (port 3850), for backend work
npm run dev:ui       # Vite dev server on :5173, proxies /api to :3850
```

`npm start` serves the built bundle from `web/dist`, so run `npm run build` after changing the client.
For UI work, prefer `npm run dev:api` + `npm run dev:ui` (HMR, no rebuild).

Environment:

| Var | Default | Purpose |
|---|---|---|
| `SOCRATES_HOME` | `~/.socrates/courses` | where courses are read from |
| `PORT` | `3850` | HTTP port |
| `HOST` | all interfaces | bind address |

The tutor runs through pi as a **child process** (`process-bridge.ts`), driven by `pi/settings.json`.

## Verifying

One gate runs everything — lint-class checks, the full test suite, typecheck and build:

```bash
npm run gate
```

Individually:

```bash
npm test                      # server suite, then the client suite
npm --prefix web run typecheck
npm run build
```

Two details that are load-bearing rather than ceremony:

- **`check-test-coverage.mjs` runs first** and fails the suite if any `*.test.ts` on disk is unreachable
  from the test scripts. A hand-maintained file list goes stale silently — the run is green and the file
  nobody named is never executed.
- **`run-suite.mjs` runs each test file separately** and asserts a non-zero test count per file, because an
  aggregate total proves nothing about *which* files ran.

## Layout

```
server.ts              HTTP API + SSE turn streaming; orchestrates a tutoring turn
course-store.ts        the one store: course discovery + reads
course-model.ts        Course → Units → Lessons → Modules derivation
journal.ts             session records, transcripts, the journal panel
history.ts             transcript reconstruction for a lesson
continuity.ts          what carries between sessions
assessments.ts         generated assessments
reports.ts             bug reports: capture, annotate, review (with path redaction)
process-bridge.ts      spawns and speaks to the pi child process
pi/                    pi extensions (learning telemetry), skills, templates

web/src/               React client (React 19 + Vite; no other runtime deps)
  components/          18 components: HomePage, CoursePage, LessonPage, QuizPage, …
  capture.ts           DOM → image capture used by the bug reporter
  markdown.ts          the tutor's prose renderer
  turn.ts              streamed turn → UI state

docs/                  CONTENT-MODEL.md (structure), EVENT-SCHEMA.md (telemetry), HANDOFF-ANALYSIS.md
DECISIONS.md           ADR-lite: frozen decisions with context, alternatives and tradeoffs
PLAN.md / TASKS.md     current work and the task list
PROGRESS.md / LESSONS.md   session history and the hard-won gotchas
```

## Design notes worth knowing

- **Generated content renders in a sandboxed iframe** with its own CSP. The interaction between sandbox
  attributes and CSP is asserted by test — the two can cancel out silently.
- **Tool calls and reasoning are not shown in the lesson.** The tutor's visible output is prose.
- **Bug reports redact absolute paths** before they are written or displayed (`reports.ts`), so captures
  and transcripts don't carry your filesystem around.
- **The back end streams over SSE**, and a turn survives a page reload — a returning tab rejoins the running
  turn and the elapsed clock carries on from the original send.

## Known limitations

- Single-user, local-only. No auth, no multi-tenancy.
- A provider outage surfaces as a reported failure with a retry, not an automatic one. The app's job is to
  be honest about a dead provider rather than to silently retry for fifteen minutes.
- The DOM capture for bug reports is not a CSS renderer: it states plainly what it does not reproduce
  (borders, radii, gradients, shadows).
