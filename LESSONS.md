<!-- When a lesson shapes your approach, cite its ID in your reply, e.g. "per GL-016". -->

# Project Lessons — socrates-web

> Only project-specific danger zones belong here. Cross-project rules live in `~/.pi/agent/LESSONS.md`.

## Danger zones

- **Emoji width in the badge format** — the 5-state badge set mixes widths: `⬜` (U+2B1C) is one
  UTF-16 code unit, while 🟥🟨🟩🟦 are two. `learning-parser.ts` already does this correctly (regex
  group + alternation, never a character class); `learning-state-manager.ts` does not
  (`m[0].slice(4, 6)`), which is how an unpaired surrogate can reach `SCHEMA.md`. Rule: **GL-016**.
- **Hook cardinality in extensions** — `turn_end` fires per agent turn (several per user prompt when
  tools run); `agent_end` fires once per run. Rule: **GL-018**. This cost a real bug: three
  `telemetry_missing` events for one grill turn, and `turns: 4` for a one-line exchange.
- **The event log must never be published** — `events.jsonl` embeds absolute paths (`cwd`, `session_file`)
  and therefore the OS username. Rule: **GL-019**. Any repo hosting a course must gitignore
  `.agent/learning/events.jsonl`, `SESSIONS/`, and `telemetry-errors.log`; only `MISSION.md` / `PLAN.md` /
  `SCHEMA.md` are safe to commit. Details and a copy-pasteable snippet: `docs/EVENT-SCHEMA.md`.
- **A substitution that matches nothing exits 0** — verify the output, not the exit code. Rule: **GL-001**
  sub-note. Cost a near-miss here: two redaction attempts silently no-op'd while reporting success.
- **`SCHEMA.md` has two writers** — authored prose (scaffold skill, human edits) and the telemetry
  projection. The projection may touch only the regions it owns and must never delete a
  misconception registry row: rows it does not know about predate the log and are authored content.
  Consequence: pre-existing duplicate ids do not self-heal — they surface as a
  `duplicate-registry-row:<id>` warning, and dedupe is a manual procedure documented in
  `docs/EVENT-SCHEMA.md`. The event schema, field semantics, and raw per-kind examples live there too.

- **A hand-maintained test-file list fails silently when it goes stale** — the run is green, the counts look
  plausible, and the file nobody named is never executed. A glob that matches nothing is the same failure in
  another shape: `node --test "src/**/*.nonexistent.ts"` prints `pass` and **exits 0**. Rule: **GL-029**.
  Two instances were live here: `web/package.json` ran `node --test src/ui.test.ts` (a hardcoded name, so a
  new client test file was silently excluded), and the root script omitted `web/src/*.test.ts` entirely
  while appearing correct because it chained the client suite.
  **The runner cannot verify its own completeness**, so the check is a separate step: `check-test-coverage.mjs`
  enumerates `*.test.ts` on disk and refuses if any is unreachable. It runs FIRST in `npm test` — a stale list
  must refuse before anything runs, or a green run claims a suite that was never complete.
  `run-suite.mjs` then runs each file separately and prints its own count, because an aggregate total proves
  nothing about which files ran, and a file discovering zero tests is reported as a failure rather than a pass.
  Seen to fail three ways: an unnamed root file, a reverted hardcoded client name, and a glob matching nothing.

- **I grepped a summary line and committed while the suite was red** — `npm test` printed
  `total 175 passed across 11 file(s), 1 failed` and I piped it through `grep -E "Test coverage ok|total .* passed"`
  and read past the `1 failed` because it sat on the same line as the count I wanted. The commit went in
  anyway. The tree happened to be correct (five subsequent runs were green, and `run-suite.mjs` was never
  asked why), but the *process* was wrong: a summary grep is not a gate. **A commit gate must assert exit
  status, not eyeball a line** — `npm test && git commit`, or read the whole block. Related to GL-024's
  silent-success family: the failure was printed, and the way I looked for it discarded it.
  The unreproduced failure itself is recorded as an open observation, not a flake: I could not name which
  test it was because I did not read the output that named it. Five later runs, including with the app
  server live and the suite run repeatedly, were green.

## GL-030 — A test that sets the store but not the ENV silently tests the developer's real data

`startServer({store})` takes an explicit store, but `discover()` calls `courseRefs()` with NO argument and
reads `process.env.SOCRATES_HOME`. A test that sets only `opts.store` therefore serves whatever is in the
developer's own `~/.socrates/courses`. Found here because the integration test POSTed to a temp fixture and got
back `404 unknown course: course-basic` while `known: ["automotive-alignments", ...]` — the real courses.

**Why it hid for a while:** a turn that never started still ends its stream with `[DONE]`, so the one assertion
that happened to be satisfied (`lines.some(l => l === "[DONE]")`) PASSED on a 404. A green test was measuring
nothing.

**Rule:** any integration test that boots a server asserts the turn/course ACTUALLY STARTED
(`assert.equal(post.status, 200, await post.text())`) before asserting anything about what it produced. And
when a test needs a temp store, set the env var the code reads — not just the option the constructor takes.

## GL-031 — A guard with a hard-coded allow-list refuses a NEW correct implementation

`ui.test.ts`'s "no component renders a raw error string" used
`/<p[^>]*>\{(?!humanMessage|view\.detail)[^}]*error[^}]*\}<\/p>/` — a two-name allow-list. Adding
`failureView`, a third legitimate mapper, tripped it. The instinct is to loosen the regex; the correct move is
to add the new mapper AND tighten the pattern elsewhere, so the guard ends up stricter than before (it gained
`String(error)`, `error.message`, `error.stack`). Then prove the guard still catches every pattern it exists
for — a list of 10 positive and negative cases — because "the suite is green again" does not mean the guard
still works.

## GL-032 — A security policy and a feature can collide silently, and the feature loses

The generated-content frame's CSP was `default-src 'none'` with **no `script-src`**. The frame's own
height-measuring script was therefore blocked, the height message never arrived, and the frame sat at its
minimum — measured, an **80px frame holding 900px of content** with no internal scrollbar, so most of a diagram
was unreachable. The feature had "shipped" and worked in no real case.

**Why it hid:** the CSP was added for security (correctly), and `allow-scripts` was added so the measuring
script could run (also correctly). Neither is wrong alone; together they cancel, and nothing tests the
interaction. A `sandbox="allow-scripts"` attribute is *permission to try*, not a guarantee it will run.

**Rule:** when a sandbox and a CSP are both in play, assert the SCRIPT actually executes — not that the
attributes are present. And when a policy tightens, check what depended on the looser one.

## GL-033 — A bounding-box intersection is not a visual overlap

I reported a "47px heading overlap" into a fix plan with a measurement behind it. Measured properly — checking
horizontal collision as well as vertical — **there was no overlap at all**: the heading ended at x=935 and the
ring began at x=1052, side by side. The two boxes shared a vertical range only because the ring was 60px tall
beside a 41px heading, which a naive `top < bottom` comparison reads as a collision.

**Rule:** geometry assertions need BOTH axes. `top < otherBottom && bottom > otherTop` is half a test — add
`left < otherRight && right > otherLeft` before calling anything overlapping. A number in a plan is a claim.

## GL-034 — An unmemoised parse in a render path is quadratic against a stream

`Markdown.tsx` called `parseMarkdown(text)` on every render, and a render happened on every streamed delta. The
two turns that froze Chrome buffered 6,219 and 6,442 SSE lines, so a **2,037-character reply was re-parsed 6,442
times — 6.6M characters, 3,222x the reply length.**

**Why it hid:** the cost is invisible on a short turn. A 1,200-line turn parses 1.2M chars and feels fine; the
same code at 6,400 lines is 6.6x worse AND blocks the main thread long enough for Chrome to declare the page
unresponsive. It only fired when the tutor edited the schema, because that is what makes a turn long.

**Rule:** any pure transformation in a component that renders from a stream must be memoised on its input, and
`setState` must not be called once per stream event. Both, not either — memoisation alone leaves 6,442 commits,
batching alone leaves a parse per commit.

## GL-035 — A capture that paints per-element cannot represent inline layout

The DOM capture gathered an element's `TEXT_NODE` children and painted them re-flowed from that element's left
edge. For a paragraph containing `<strong>Recap:</strong>`, the parent's own text is **99 chars of a 106-char
paragraph** — so it painted the text *as if the strong did not exist*, and the strong then painted "Recap:" at
its own rect, which is where that re-flow had already put other words.

**Rule:** when painting text yourself, an inline child's words belong to the PARENT's run, not to a second paint.
A block child is the opposite and paints itself. Getting this backwards produces text that looks doubled and
shifted, which reads as a broken app rather than a broken capture.

## GL-036 — A focus-visible element is visible to a capture

The skip link sits at `left: -9999px`, so the off-screen guard excluded it — until someone tabbed once. Focus
moves it to `left: 0px` (that IS the accessibility behaviour), where it passes every visibility check and gets
painted over the page chrome.

**Rule:** "off-screen" is a STATE, not a property. Anything hidden by position rather than `display`/`visibility`
can become visible, and a capture walks whatever state the page is in when the button is pressed.

## GL-037 — A display decision inside a shared reader deletes data from the other consumers

`collapseRepeats` was called inside `readJournal`. That function has FIVE consumers and exactly one of them
wants the collapse — the journal listing. The history endpoint builds the transcript from the same list, so
folding duplicates for the panel silently removed them from the RESTORE. Measured: 3 session files holding 40
turns, 8 served. **80% of the owner's conversation was unreachable**, and nothing crashed.

**Why it hid:** the panel looked correct. The collapse was doing exactly what was asked, in the wrong place, and
no test covered the second consumer — every test drove `readJournal` directly and asserted the collapsed shape.

**Rule:** when a helper gains a caller, its return value becomes a contract for all of them. Put a
presentation decision at the PRESENTATION layer, and when you add one, enumerate the existing consumers before
choosing where it goes.

## GL-038 — Two tabs agreeing is not evidence of correctness

The owner duplicated a tab, saw different content, refreshed, and found both tabs agreed. That reads like the
problem resolving itself. It was the opposite: both tabs had converged on the COLLAPSED source, so they agreed
on the loss. **The divergence was the honest state.**

**Rule:** when two views of the same data disagree, find which one is lying before celebrating that they match.
And treat "it fixed itself on refresh" as a stronger warning, not a weaker one — it means state is being
recomputed from a source that has already dropped something.

## GL-039 — A subscription path reachable only from `send()` cannot be reached by a reload

`new EventSource(...)` appeared exactly once in the whole client, inside the `send()` function. So a tab
subscribed only when IT sent a message — meaning a reloaded tab, which sends nothing, never opened a stream and
could not rejoin a running turn even after the server was fixed to allow it. The server log said `ATTACH s2` and
nothing else.

**Why it hid:** the feature "worked" in the only case anyone had exercised — type a message, watch the reply.
The reload path was a second entry point to the same behaviour and nobody had listed the entry points.

**Rule:** when you make a capability re-usable (rejoining a turn, resuming a session), enumerate every way a
user can ARRIVE at it, not just the one you built it for. A code path reachable from a single caller is a sign
the second caller has not been considered yet.

## GL-040 — A render order can hide a state that is genuinely set

`{prose ? <prose> : busy ? <presence> : …}` — restored history makes `prose` truthy, so after a rejoin the
`busy` branch was unreachable and the learner saw a finished-looking conversation while the tutor was still
working. The state was correct (`sendDisabled: true` proved `busy` was set); only the branch order hid it.

**Rule:** when two states can be true at once — history present AND a turn running — a ternary chain order is a
silent priority decision. Test the pair, not each alone.
