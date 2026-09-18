## 2026-09-15 13:51 — Reload mid-turn now rejoins the turn





<!-- session-in-progress:start=2026-09-18T08:03:40.653Z -->
## 2026-09-18 03:28 — the sample course is off the tree

Owner, 2026-09-18: *"roll back those drift scout things... that was a sample course that I had run"*,
clarified as *"pull it down from the tree, get rid of the drift scout example"*. Redaction, not a
history rewrite — the same choice made in `faf6933`, whose message already recorded that scrubbing
history would need a rewrite.

**Changed:** the sample course's name is gone from all 6 tracked files that carried it (26
occurrences), plus the absolute paths that surrounded it. It was not only the name: the course's
**concept ids** (the sample course's own concept slugs, and the spike vocabulary in
`docs/HANDOFF-ANALYSIS.md`) are as identifying as the name, so those went too.

Two deliberate non-changes, both recorded rather than silently skipped:

- **~10 lowercase `drift` hits are false positives** — `badge_drift`, "so the two cannot drift",
  "sessions drift into passive reading". English, not the course. Left alone.
- **`server.test.ts` keeps `idempotent-migrations`** — that is an invented subject the test POSTs
  (beside "React Internals"), with no identifying context. It happens to collide with the sample
  course's vocabulary. Changing it would churn a passing integration test for no privacy gain.

`docs/HANDOFF-ANALYSIS.md` needed care, not find-and-replace: its spike outputs are the *evidence*
that prose-matching fails, and genericizing them without saying so would have left the document
claiming a spike that visibly did not run. It now carries a header note stating the ids are
placeholders and that the finding — one unit per concept card, not per PLAN phase — is unaffected.

**Verified:** `git grep` for the course name, the sample concept slugs and the absolute
courses-root path each returns **0** across every tracked file; the 40
untouched `drift` false positives confirmed by reading each hit; `npm run gate` green.
<!-- end-session-in-progress -->
## 2026-09-18 03:26 — Redacted: the sample course is out of the tree

Owner asked to remove a sample course (a different project of theirs, run through this app as test
content) from the tree entirely — *"those should not be in this Socrates project at all"*. Chose
**redaction over a history rewrite**: the name is gone from the working tree and every tracked file,
and the 8 commits that introduced it are left as-is, consistent with `faf6933`'s earlier decision.

Scope was larger than first reported. The name sat in **6 tracked files, 26 occurrences**
(`DECISIONS.md` 4, `PROGRESS.md` 11, `TASKS.md` 2, `docs/EVENT-SCHEMA.md` 1,
`docs/HANDOFF-ANALYSIS.md` 2, `web/src/ui.test.ts` 6), with absolute courses-root paths in three
of them. The first scan reported "~10 in PROGRESS.md" because it was scoped to one file and used a
count that missed most hits — the partial-detector failure again, one level up.

**Verified:** every replacement confirmed by reading the output back, not by exit code; `git grep`
for the name and the path returns 0 hits; backups of all 6 files taken to `.agent/scratch/`
(gitignored) before editing.

## 2026-09-18 03:01 — **Changed:** no edits — investigation only
**Changed:** no edits — investigation only. Confirmed no README exists locally or on `origin/main`; verified remote head server-side
**Verified:** `git ls-files | grep -i readme` and `git ls-tree -r origin/main | grep -i readme` both empty; `gh api repos/.../commits/main` → `sha 84d89a0`, `committer_date 2026-09-15T18:51:47Z`; repo `pushed_at 2026-09-18T07:39:09Z` (today); `git ls-remote --heads origin` → one branch `main` @ `84d89a0` = local HEAD; `git log --oneline e288ed4..84d89a0 | wc -l`...
## 2026-09-17 23:04 — **Changed:** deleted 35 files (18 addressed reports + their PNGs) from ~/.socrat...
**Changed:** deleted 35 files (18 addressed reports + their PNGs) from ~/.socrates/reports, keeping 4 non-defects; triage written to .agent/scratch/report-triage.md with each verdict citing its fixing commit, plus a delete script that refuses to remove anything marked KEEP
**Verified:** each of the 18 traced to the commit that addressed it; the delete list cross-checked against the keep-prefixes by the script; /api/reports now returns 4 with the page rendering, /health 200, and the charger tr...
## 2026-09-15 22:58 — **Changed:** deleted 35 files (18 addressed reports + their PNGs) from ~/.socrat...
**Changed:** deleted 35 files (18 addressed reports + their PNGs) from ~/.socrates/reports, keeping 4 non-defects; triage written to .agent/scratch/report-triage.md with each verdict citing its fixing commit, plus a delete script that refuses to remove anything marked KEEP
**Verified:** each of the 18 traced to the commit that addressed it; the delete list cross-checked against the keep-prefixes by the script; /api/reports now returns 4 with the page rendering, /health 200, and the charger tr...
Owner asked that a learner returning mid-turn "jump back into the session as if they never left", with the
elapsed clock carrying on from the original send. Found four blockers, all fixed in `84d89a0`: the server
refused a second subscriber, the restore read a session record that does not exist until the session closes, the
client only ever subscribed from `send()`, and the render order hid the presence line behind restored history.

Before relying on the live JSONL I tested the owner's stated worry — that an interrupted run would leave
something unusable. Killed pi mid-turn: file intact, 0 malformed lines, complete final line, and a hard kill
mid-write loses only the truncated turn. That tolerance is now pinned by tests rather than incidental.

Verified in the browser: two subscribers attached to one turn, 77 lines replayed to the rejoining tab, the
conversation restored (26 blocks / 20,140 chars where it had been 1 block / 143), "Socrates is thinking…"
visible, and the clock reading "6s" rather than restarting at 1.

## 2026-09-15 12:50 — Two tabs, two different lessons, and 32 lost turns

Owner duplicated a tab to test for data loss and found the two tabs showing different content for one lesson.
Investigated with the investigate-bug skill and found the collapse I added for D3 was living inside
`readJournal`, which the history endpoint reads — so folding duplicates for the journal panel also deleted them
from the RESTORE. 3 session files holding 40 turns, 8 served.

The collapse key was also too aggressive: it compared concepts and misconception rows but ignored TIME and turn
count, so three sittings an hour apart all looked identical. It now requires the same sitting, the same
open/closed state and the same turn count, and the collapse moved to the journal endpoint where it belongs.

Committed as `0be2d6d`. The alarming part is recorded as GL-038: refreshing made the tabs AGREE, which reads
like a fix and was actually both tabs converging on the loss. The divergence was the honest signal.

## 2026-09-15 12:24 — Internals off the screen, a turn that cannot freeze, a capture that stops doubling


## 2026-09-15 14:02 — **Changed:** `liveStreams` set replaces the single SSE slot with a bounded multi...
**Changed:** `liveStreams` set replaces the single SSE slot with a bounded multi-subscriber broadcast while keeping the different-course refusal; `/history` reads the live pi JSONL for the running session; `subscribeToTurn()` lifted out of `send()` and called from the restore effect; `turn_state` is sent to late subscribers with the original `startedAt` and adopted by the client; the presence line renders whenever a turn is running; truncated-tail tolerance pinned by tests; GL-039/GL-040 reco...
Owner's instruction to remove tool calls and reasoning from the lesson entirely, plus a browser freeze they hit
mid-conversation. Committed as `cde3cf9`.

The freeze was the interesting one: `parseMarkdown` was called on every render and a render happened on every
streamed delta, so the two runaway turns re-parsed a 2KB reply 6,442 times — 6.6M characters, quadratic. Fixed
by memoising the parse AND batching deltas to one update per 50ms. The removal of the reasoning drawer helped
too, since reasoning is often longer than the prose.

Worth recording: my first read of the owner's screenshot was WRONG. I said it showed tool narration "in the
chat". Tracing found zero narration in the assistant's text parts — it was all `thinking`, rendered by the
drawer. The owner's instruction happened to be right anyway, but for a reason I had not established.

Also corrected: D6's reasoning fix from yesterday is deliberately REVERSED by this change, while D6's
opening-turn fix stays and is pinned by its own test. Verified in the browser that a 9.7-second tool-heavy turn
(which logged MIS-002 as it ran) held the main thread with a worst stall of 0ms.

## 2026-09-15 01:53 — The 18 reported defects of 2026-09-15





## 2026-09-15 12:35 — **Changed:** the reasoning drawer, its reducer field and its restore are removed...
**Changed:** the reasoning drawer, its reducer field and its restore are removed while `thinking` still persists to disk; `parseMarkdown` memoised and stream deltas batched through a new `stream-throttle.ts`; `planPaint`/`shouldPaint` in `capture-position.ts` stop inline children double-painting and exclude the focused skip link; GL-034…GL-036 recorded
**Verified:** gate exit 0; agent-browser confirming the drawer and both literal screenshot strings are absent from the DOM, a focused skip lin...
## 2026-09-15 11:53 — **"Page Unresponsive" — that's the real crash.** The screenshot shows the browse...
**"Page Unresponsive" — that's the real crash.** The screenshot shows the browser reporting the page is frozen with "Wait" / "Exit page", and the console shows "Waiting…".

And critically, this is **not the same bug** as the capture artifact. Let me look at the load:
## 2026-09-15 11:35 — Fair
Fair. Here's the whole reply, one block:

```
Charger Heat Ledger is good — take the rename.

Right. Two things to add before you write:

1. My wrong assumption is the target. I came in thinking the warmth means the
   charger is working hard. That's the thing I want to be caught on — it's the
   reason I'm doing this at all.

2. I'll be getting things wrong on purpose to check the app catches it. Don't
   over-correct me — push back once, then let me try again.

And one thing for the record:...
## 2026-09-15 11:30 — Now I can answer precisely
Now I can answer precisely. Your baseline is **activating prior knowledge** — it tells the tutor what it can skip and where the edges of your understanding are. Notice yours already does real work: it says you've *done* string alignments, so the tutor doesn't waste time on what a tie rod is.

## Where to put your starting point

**Be specific about the boundary — where your knowledge stops — not about what you're vaguely unsure of.**

The baseline's job is to stop the tutor teaching you thing...
Investigated every real report in `~/.socrates/reports/` (21 real, 6 smoke tests) with the investigate-bug
skill, reading each report's JSON, screenshot and session file. Wrote the findings and the TDD plan to
`.agent/plans/2026-09-15-reported-defects-fix.md` with a report index mapping each defect to the owner's own
words, then implemented all 18 RED-first in `cf2af88`.

The headline finding is that the app was telling the learner things it should not (raw `<learning-telemetry>`
in the chat, the session RECORD's markdown with absolute paths and MIS- ids) and failing to tell it things it
should (reasoning after a reload, the tutor's opening explanation, that Review existed). Several had a single
missing line behind them: `review` was absent from `TUTOR_MODULE_TYPES`, and the skill-dispatch filter was
dropping every tutor-opened turn. Server 201→223 across 14 files, client 222→254, tsc and build clean, gate
exit 0, and every fix verified in the agent browser against the real courses.

Two corrections recorded against my own earlier work: the 47px heading overlap did not exist (GL-033), and D4's
cause was the CSP I added during the sandbox work blocking the frame's own measuring script (GL-032).

## 2026-09-14 23:54 — A failed turn now says so, and the capture stops lying


## 2026-09-15 02:06 — **Changed:** telemetry stripped server-side with a cross-delta buffer plus a con...
**Changed:** telemetry stripped server-side with a cross-delta buffer plus a conditional misconception notice; sessions collapse silently; the journal shows the real transcript; reasoning restores and the opening turn re-fires on a new arrival; full history with no tail; a new explain-concept skill and a scanned skills list; fixed US locale via --append-system-prompt; Review wired up; module rows named for their action; home rename removed; frame CSP fixed so diagrams size themselves
**Verifi...
Read the owner's three newest bug reports plus their screenshots and the pi session behind them, and found
the reports were about the app being SILENT rather than the tutor being broken: pi emitted
`auto_retry_end {success:false, finalError:"…900-second timeout limit…"}` four times ~906s apart while the
app consumed only `text_delta` and discarded every other event, so a provider outage was indistinguishable
from a slow turn for 45 minutes. Traced the mechanism from pi's source with line numbers
(`agent-session.js:706/2018/418`, `settings-manager.js:555`), which closed the arithmetic on the observed
gaps exactly, and noted the CRITICAL trap that `auto_retry_end` is guarded by `_retryAttempt > 0` so a
first-attempt non-retryable error emits no retry events at all.

Fixed both that and the capture's double-counted scroll offset (owner chose option 2, fix positioning), with
every test seen to fail first. Added the liveness work the owner asked for after telling me deepseek was
down for hours: a visible clock, a retrying state, and a stalled state derived from time since OUTPUT so a
long streaming turn is never mislabelled. Server 197→201 across 13 files, client 188→222, tsc and build
clean, gate exit 0. Verified in the agent browser against the real course — the outage notification renders
with a working Try again (fetch spy confirmed the POST), a healthy turn shows no failure, and a capture at
420px pane scroll comes out clean.

Two corrections recorded honestly: the 48px error I first reproduced was a document-scrolled page, not this
app's layout (whose document never scrolls), and two of my own tests initially passed for the wrong reason —
GL-030 records the env-vs-option trap that caused it.

# Progress

> Rolling session summaries, newest first.













































## 2026-09-15 00:07 — **Changed:** nothing — this was a restart, not a code change
**Verified:** /heal...
**Changed:** nothing — this was a restart, not a code change
**Verified:** /health 200 on 127.0.0.1:3850, home and lesson pages render, and a live turn returned a real deepseek reply ("Camber is the tilt of the wheel's plane away from vertical…") with no failure banner
**Next:** it's running now, pid 692, so open http://127.0.0.1:3850 — but note it will stop again if that process is killed; if you want it to survive, it needs starting detached rather than backgrounded from a shell that exits
## 2026-09-14 22:44 — Plan written, grill run
Plan written, grill run. Per the skill, I show you the plan and stop before code. Two things need you.

## What I found (this is the important part)

**Your "socratic thinking broken" reports were never about the tutor.** I traced the failure to pi's source with line numbers:

- `agent-session.js:706-714` — pi emits `auto_retry_end {success: false, finalError: "..."}` when it stops retrying. That event **carries the provider's error verbatim** and fires exactly once.
- `agent-session.js:418` ...
## 2026-09-14 16:09 — **Changed:** a markdown parser returning data structures (no innerHTML anywhere)...
**Changed:** a markdown parser returning data structures (no innerHTML anywhere) with emphasis, code, links, lists, tables and headings rendered in the chat; a sandboxed GeneratedFrame for HTML and SVG with the null-origin isolation pinned by test; ```mermaid surfaced honestly rather than half-rendered; table cells now parsed for inline markup; the decision recorded in DECISIONS.md before the renderer was written
**Verified:** 197 server + 188 client tests, tsc clean, vite build, gate exit 0;...
## 2026-09-14 15:47 — **Changed:** a markdown parser returning data structures (no innerHTML anywhere)...
**Changed:** a markdown parser returning data structures (no innerHTML anywhere) with emphasis, code, links, lists, tables and headings rendered in the chat; a sandboxed GeneratedFrame for HTML and SVG with the null-origin isolation pinned by test; ```mermaid surfaced honestly rather than half-rendered; table cells now parsed for inline markup; the decision recorded in DECISIONS.md before the renderer was written
**Verified:** 197 server + 188 client tests, tsc clean, vite build, gate exit 0;...
## 2026-09-14 14:44 — **Changed:** a markdown parser returning data structures (no innerHTML anywhere)...
**Changed:** a markdown parser returning data structures (no innerHTML anywhere) with emphasis, code, links, lists, tables and headings rendered in the chat; a sandboxed GeneratedFrame for HTML and SVG with the null-origin isolation pinned by test; ```mermaid surfaced honestly rather than half-rendered; table cells now parsed for inline markup; the decision recorded in DECISIONS.md before the renderer was written
**Verified:** 197 server + 188 client tests, tsc clean, vite build, gate exit 0;...
## 2026-09-14 13:59 — **Changed:** a markdown parser returning data structures (no innerHTML anywhere)...
**Changed:** a markdown parser returning data structures (no innerHTML anywhere) with emphasis, code, links, lists, tables and headings rendered in the chat; a sandboxed GeneratedFrame for HTML and SVG with the null-origin isolation pinned by test; ```mermaid surfaced honestly rather than half-rendered; table cells now parsed for inline markup; the decision recorded in DECISIONS.md before the renderer was written
**Verified:** 197 server + 188 client tests, tsc clean, vite build, gate exit 0;...
## 2026-09-14 13:55 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `TopBar.tsx:38-47` is where the toggle lives; `storeRoot()` at `course-store.ts:20-22` is the override point for a sibling reports directory; the client has no capture code today and the project ships two runtime dependencies; `permissions.query('display-capture')` returns `prompt` in your Brave, confirming the dialog is unavoidable per capture.
**Next:** send it. When it reports I'll verify the round-trip myself — including checking that no tes...
## 2026-09-14 13:37 — **Changed:** a markdown parser returning data structures (no innerHTML anywhere)...
**Changed:** a markdown parser returning data structures (no innerHTML anywhere) with emphasis, code, links, lists, tables and headings rendered in the chat; a sandboxed GeneratedFrame for HTML and SVG with the null-origin isolation pinned by test; ```mermaid surfaced honestly rather than half-rendered; table cells now parsed for inline markup; the decision recorded in DECISIONS.md before the renderer was written
**Verified:** 197 server + 188 client tests, tsc clean, vite build, gate exit 0;...
## 2026-09-14 12:38 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `TopBar.tsx:38-47` is where the toggle lives; `storeRoot()` at `course-store.ts:20-22` is the override point for a sibling reports directory; the client has no capture code today and the project ships two runtime dependencies; `permissions.query('display-capture')` returns `prompt` in your Brave, confirming the dialog is unavoidable per capture.
**Next:** send it. When it reports I'll verify the round-trip myself — including checking that no tes...
## 2026-09-14 12:25 — **Changed:** the history endpoint takes ?unit= and assembles that unit's session...
**Changed:** the history endpoint takes ?unit= and assembles that unit's sessions (matched slug-normalised against Unit.concepts from the existing tree) chronologically with the tail limit and honest truncated flag; fetchHistory requires the unit and the fetch effect now depends on it; the throwaway two-unit fixture and its generator added then removed
**Verified:** 181 server + 149 client tests, tsc clean, vite build served-hash-identical, gate exit 0; test 1 failed on the OLD code with `uni...
## 2026-09-14 12:28 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `TopBar.tsx:38-47` is where the toggle lives; `storeRoot()` at `course-store.ts:20-22` is the override point for a sibling reports directory; the client has no capture code today and the project ships two runtime dependencies; `permissions.query('display-capture')` returns `prompt` in your Brave, confirming the dialog is unavoidable per capture.
**Next:** send it. When it reports I'll verify the round-trip myself — including checking that no tes...
## 2026-09-14 12:10 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `SessionSummary.concepts` populated at `journal.ts:153,165`; `Unit.concepts` at `course-model.ts:145,292`; the endpoint at `server.ts:793` takes no unit and serves one session; `history.ts` documents the settled-only rule; the owner's 10 sessions all resolve to unit 1.
**Next:** send it. G3 stays parked until you've used the app — and after this lands, the open list is just two product calls and whatever real use turns up.
## 2026-09-14 12:15 — **Changed:** the history endpoint takes ?unit= and assembles that unit's session...
**Changed:** the history endpoint takes ?unit= and assembles that unit's sessions (matched slug-normalised against Unit.concepts from the existing tree) chronologically with the tail limit and honest truncated flag; fetchHistory requires the unit and the fetch effect now depends on it; the throwaway two-unit fixture and its generator added then removed
**Verified:** 181 server + 149 client tests, tsc clean, vite build served-hash-identical, gate exit 0; test 1 failed on the OLD code with `uni...
## 2026-09-14 12:00 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `SessionSummary.concepts` populated at `journal.ts:153,165`; `Unit.concepts` at `course-model.ts:145,292`; the endpoint at `server.ts:793` takes no unit and serves one session; `history.ts` documents the settled-only rule; the owner's 10 sessions all resolve to unit 1.
**Next:** send it. G3 stays parked until you've used the app — and after this lands, the open list is just two product calls and whatever real use turns up.
## 2026-09-14 11:40 — **Changed:** unit resolution moved into a pure rule with the router preserving t...
**Changed:** unit resolution moved into a pure rule with the router preserving the requested unit, so out-of-range renders an explicit state and no label can print a non-integer or exponential number; six label selectors raised to 12px on a new --ink-label token with --ink-45 untouched; a skip link added as the first focusable element with an explicit focus move to a target each route carries; the composer wired to grow to the previously-dead max-height and shrink back
**Verified:** 176 serve...
## 2026-09-14 11:00 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** HEAD `4855faf` with a clean tree; G2's two disagreeing lines (`:254`, `:422`); F1a is four selectors at three sizes, not one — `theme.css:86,240,265,276`, all on `--ink-45` (`theme.css:13`).
**Next:** send it. When it reports, I'll verify the contrast numbers myself, since that's the one where a naive measurement already produced a wrong figure once.
## 2026-09-14 10:50 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** HEAD `4855faf` with a clean tree; G2's two disagreeing lines (`:254`, `:422`); F1a is four selectors at three sizes, not one — `theme.css:86,240,265,276`, all on `--ink-45` (`theme.css:13`).
**Next:** send it. When it reports, I'll verify the contrast numbers myself, since that's the one where a naive measurement already produced a wrong figure once.
## 2026-09-14 10:45 — **Changed:** nothing — verification
**Changed:** nothing — verification. I reverted `web/package.json` briefly to test the guard and restored it; confirmed the restore.
**Verified:** the glob-exits-0 claim reproduced; the stale root list read from the previous commit; the coverage guard refuses with exit 1 both directly and through `npm test`; the no-assertion `pass 1` behaviour reproduced; the full suite run (176/11 attributable, 129 client, exit 0).
**Next:** your call — the small batch above, or move to using it.
## 2026-09-14 10:41 — **Changed:** check-test-coverage.mjs enumerates every test file on disk and refu...
**Changed:** check-test-coverage.mjs enumerates every test file on disk and refuses if the scripts cannot reach one, running first in npm test; run-suite.mjs runs each file separately with an attributable count and documented limits; web/package.json globs; GL-029 recorded in the harness and project lessons
**Verified:** the coverage check refuses all three stale forms (unnamed root file, reverted hardcoded client name, glob matching nothing) with exit 1 and exits 0 when restored; node exits ...
## 2026-09-14 10:35 — **Changed:** nothing — verification
**Changed:** nothing — verification.
**Verified:** the hardcoded command existed from `b983508` across 44 commits (read from `git log -S`); only one other client test file exists now, so nothing was actually hidden; the root command names all 10 root test files (checked programmatically, none missing); the harness guard declares rather than globs, which is why it caught its own version of this.
**Next:** approve the follow-up above, then G2 or the accessibility trio. The remaining list is sho...
## 2026-09-14 10:24 — **Changed:** B2a classifies material failures so a course that cannot be read is...
**Changed:** B2a classifies material failures so a course that cannot be read is not blamed on the quiz, with the retry control gated on the failure being retryable; the catalogue derives a blocked rename's label from the directory using a Set lookup rather than N reconcile calls; web/package.json now globs test files instead of hardcoding one
**Verified:** 176 server + 129 client tests, tsc clean, vite build with served hash == built and the app live on that bundle; three B2a wiring tests fa...
## 2026-09-14 10:15 — Search behaves consistently: searching `locked` finds it; searching `Taken` find...
Search behaves consistently: searching `locked` finds it; searching `Taken` finds only the real `taken` course (not `locked`), which is correct — `locked` no longer claims a name it cannot reach. The blast radius is coherent across all five consumers.

Cleaning up and running final gates:
## 2026-09-14 10:12 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** HEAD `4c661b3`, clean tree; `QuizPage.tsx:69` and `LabPage.tsx:212` both hardcode a subsystem-specific message; `server.ts:651-658` serves `discover()` output with no reconcile and no capture, unlike `:758`; `course-store.ts:87` derives the label from the H1 alone.
**Next:** send it. After this, the open list is G2, the accessibility trio, A1's design session, and three product calls — and I'd hold off on further audit rounds until you've used it.
## 2026-09-14 10:02 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** HEAD `4c661b3`, clean tree; `QuizPage.tsx:69` and `LabPage.tsx:212` both hardcode a subsystem-specific message; `server.ts:651-658` serves `discover()` output with no reconcile and no capture, unlike `:758`; `course-store.ts:87` derives the label from the H1 alone.
**Next:** send it. After this, the open list is G2, the accessibility trio, A1's design session, and three product calls — and I'd hold off on further audit rounds until you've used it.
## 2026-09-14 09:58 — **Changed:** the read path captures reconcile's result and derives a blocked ren...
**Changed:** the read path captures reconcile's result and derives a blocked rename's title from the directory with a rename-blocked warning, and the course page now prefers the tree over the list; humanMessage maps known server failures to copy across eight rendered sites plus data.detail, with looksLikeDeveloperText shared by copy and tests
**Verified:** 174 server + 121 client tests, tsc clean, vite build with served hash == built; three B3 tests failed on the defect before the change and ...
## 2026-09-14 09:21 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** HEAD `5da93c9` with a clean tree; the `:740`/`:756` asymmetry confirmed; the eight error-copy sites re-counted; `courseErrorView` and `stripAbsolutePaths` located as existing precedents, with `stripAbsolutePaths` already applied at `JournalPanel.tsx:111`.
**Next:** send it. After these two land, the open list is A1 (design), G2, F1a/F2/F3 (accessibility), and three product calls — at which point I'd argue for using the app for a week rather than...
## 2026-09-14 09:00 — **Changed:** D2 redacted at both excerpt sites with describeReply and a response...
**Changed:** D2 redacted at both excerpt sites with describeReply and a response-boundary test; the unreachable rest gate removed from the UI with restgate.ts and its tests kept as the design record; app-dispatched turns carry an origin and render as a labelled action rather than the learner's words; T-058 corrected
**Verified:** 171 server + 116 client tests, tsc clean, vite build with served hash == built; three D2 tests failed before the fix and pass after, including one against a real ans...
## 2026-09-14 08:50 — **Changed:** D2 redacted at both excerpt sites with describeReply and a response...
**Changed:** D2 redacted at both excerpt sites with describeReply and a response-boundary test; the unreachable rest gate removed from the UI with restgate.ts and its tests kept as the design record; app-dispatched turns carry an origin and render as a labelled action rather than the learner's words; T-058 corrected
**Verified:** 171 server + 116 client tests, tsc clean, vite build with served hash == built; three D2 tests failed before the fix and pass after, including one against a real ans...
## 2026-09-14 08:43 — **Changed:** nothing — verification of the worker's correction
**Changed:** nothing — verification of the worker's correction.
**Verified:** `turn.error` has four fixed sources (`server.ts:576,577,606,611`), none carrying model output; the single `excerpt` carrier at `:976`/`:1088`; validation failures report counts only (`assessments.ts:67-68`). My "three conditions" was wrong — they were three branches of one field.
**Next:** tell it to proceed with D2 (RED test at the response boundary, then the two removals), the E1 deletion with tests preserved, the...
## 2026-09-14 08:28 — **Changed:** nothing (verification of the worker's report)
**Changed:** nothing (verification of the worker's report).
**Verified:** all four refutations checked against source; D2 confirmed at `server.ts:976,1088` with the reachable-failure paths read from `extractItems`; found `stripAbsolutePaths` already applied at `JournalPanel.tsx:111`, which corrects G6's "one fix" claim.
**Next:** approve D2 and I'll write the RED test first — assert the 422 response never contains a fenced JSON block or an `answer` field, then the minimal change to drop the e...
## 2026-09-13 23:54 — **Changed:** nothing — investigation only
**Verified:** every verdict above carr...
**Changed:** nothing — investigation only
**Verified:** every verdict above carries a pasted command or browser output; tree clean at 9ea6404; owner's automotive-alignments intact (MISSION.md H1 = "Automotive Alignments", reads HTTP 200); no pi session spawned; all scratch probes and throwaway stores removed
**Next:** approve a root cause and I will write its RED test first — start with D2 (answer-key leak), then the Group 1 error-copy fix
## 2026-09-13 23:44 — **Changed:** nothing (answer + correction)
**Changed:** nothing (answer + correction).
**Verified:** `usage.md:308` — sub-agents are not built in; `extensions.md:2984` — a `subagent/` extension pattern exists; your `~/.pi/agent/extensions/` contains no such extension; the `pi-web` routes are a different codebase.
**Next:** tell the worker to proceed serially and mark anything needing a counter-check, then send me the report — and separately, tell me if you want the subagent extension installed as its own task after this round lands.
## 2026-09-13 22:55 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `ChatMessage.tsx` absent from the repo; the grill href read from the live DOM; module rows at `CoursePage.tsx:256-266` carry no `ask`; the dispatch guard at `LessonPage.tsx:208-220`; zero `iframe`/`srcdoc`/`dangerouslySetInnerHTML` in the client; `detectGrillTurn` at `signal.ts:56-63`.
**Next:** hand it over. If you want a fast loop, tell the worker to stop after Step 3 — that's the set that fixes what you've actually been feeling.
## 2026-09-13 22:26 — **Changed:** quiz titles humanised (A1); render-site guard widened to the model ...
**Changed:** quiz titles humanised (A1); render-site guard widened to the model modules with line-exact exemptions and a seen-to-fail proof (A2/A3); the lesson follows renames once, never mid-turn, and a stale id now reads as a sentence with a link back (B1-B4); `session.ts` composes the app's own tutor session with adoption, ensureHome, preflight and `/api/session`; the shipped skills and templates ship in-repo and are rewritten so instruction cannot read as dialogue; harness copies of the t...
## 2026-09-13 22:45 — **Changed:** nothing (directive)
**Changed:** nothing (directive).
**Verified:** `ChatMessage.tsx` absent from the repo; the grill href read from the live DOM; module rows at `CoursePage.tsx:256-266` carry no `ask`; the dispatch guard at `LessonPage.tsx:208-220`; zero `iframe`/`srcdoc`/`dangerouslySetInnerHTML` in the client; `detectGrillTurn` at `signal.ts:56-63`.
**Next:** hand it over. If you want a fast loop, tell the worker to stop after Step 3 — that's the set that fixes what you've actually been feeling.
## 2026-09-13 22:16 — **Changed:** quiz titles humanised (A1); render-site guard widened to the model ...
**Changed:** quiz titles humanised (A1); render-site guard widened to the model modules with line-exact exemptions and a seen-to-fail proof (A2/A3); the lesson follows renames once, never mid-turn, and a stale id now reads as a sentence with a link back (B1-B4); `session.ts` composes the app's own tutor session with adoption, ensureHome, preflight and `/api/session`; the shipped skills and templates ship in-repo and are rewritten so instruction cannot read as dialogue; harness copies of the t...
## 2026-09-13 21:41 — 146 server + 105 client, all green
146 server + 105 client, all green. That earlier failure was the untimeout'd run hitting node's default. Now D7 — the full-loop acceptance on a fresh course, plus D8.

First, restarting the server on the new bridge and running the acceptance against the **real store**:
## 2026-09-13 21:05 — **Changed:** the Part D design reduced to what the spikes actually proved, with ...
**Changed:** the Part D design reduced to what the spikes actually proved, with the model-resolution correction and `feynman-recite` filed rather than fixed.
**Verified:** four spawned-child runs isolating the model-resolution cause; `PI_OFFLINE` exonerated; explicit `--model` proved sufficient without a catalog; repo clean at `477a462` with the spike directory removed.
**Next:** send it. Hold Part C, and when D lands, run your own test round — the tutor's voice is the thing only you can judge.
## 2026-09-13 20:57 — **Changed:** humanize() is Title Case with the word-level deliberate-casing rule...
**Changed:** humanize() is Title Case with the word-level deliberate-casing rule and applies to authored text too; skill Step 6 and the SCHEMA template author Title Case; derived module titles drop the leading verb (recite/review lose it, explain keeps its qualifier); moduleRingLabel extracted so the three accessible names stay distinct; 12 test assertions updated, 4 added; T-052 revised and T-056 added
**Verified:** 136 server + 98 client tests pass, tsc clean, vite build ok with served hash...
## 2026-09-13 20:55 — **Changed:** the Part D design reduced to what the spikes actually proved, with ...
**Changed:** the Part D design reduced to what the spikes actually proved, with the model-resolution correction and `feynman-recite` filed rather than fixed.
**Verified:** four spawned-child runs isolating the model-resolution cause; `PI_OFFLINE` exonerated; explicit `--model` proved sufficient without a catalog; repo clean at `477a462` with the spike directory removed.
**Next:** send it. Hold Part C, and when D lands, run your own test round — the tutor's voice is the thing only you can judge.
## 2026-09-13 19:59 — **Changed:** humanize() is Title Case with the word-level deliberate-casing rule...
**Changed:** humanize() is Title Case with the word-level deliberate-casing rule and applies to authored text too; skill Step 6 and the SCHEMA template author Title Case; derived module titles drop the leading verb (recite/review lose it, explain keeps its qualifier); moduleRingLabel extracted so the three accessible names stay distinct; 12 test assertions updated, 4 added; T-052 revised and T-056 added
**Verified:** 136 server + 98 client tests pass, tsc clean, vite build ok with served hash...
## 2026-09-13 20:47 — **Next:** want me to write the A + B + D directive now, with the spike correctio...
**Next:** want me to write the A + B + D directive now, with the spike corrections folded in and `feynman-recite` filed as a tracked item? I'd keep C separate so you can run your own test round on top of it before the UI round lands.
## 2026-09-13 19:49 — **Changed:** humanize() is Title Case with the word-level deliberate-casing rule...
**Changed:** humanize() is Title Case with the word-level deliberate-casing rule and applies to authored text too; skill Step 6 and the SCHEMA template author Title Case; derived module titles drop the leading verb (recite/review lose it, explain keeps its qualifier); moduleRingLabel extracted so the three accessible names stay distinct; 12 test assertions updated, 4 added; T-052 revised and T-056 added
**Verified:** 136 server + 98 client tests pass, tsc clean, vite build ok with served hash...
## 2026-09-13 19:53 — **Changed:** nothing (design + directive)
**Changed:** nothing (design + directive).
**Verified:** the type labels at `module-types.ts:37-38`, the title construction at `course-model.ts:223-234`, and the aria-label at `CoursePage.tsx:277`, all read from source; the current `humanize` behaviour confirmed by running it.
**Next:** send it — then Parts 1 and 2 of the audit are the only substantive items left.
## 2026-09-13 23:10 — P17: human-readable names

Every concept name reached the screen as its slug, because `name` is simultaneously the display string
and the identity. Fixed in two layers with one function: `humanize()` in `web/src/humanize.ts`, applied
where text becomes pixels and nowhere else, because `title`/`name`/`concept` are compared in
`CoursePage`, used as module id stems, and passed to the tutor as the grill argument. The one exception
is `course-model.ts`, which builds module titles by concatenation and so humanises at the point of
building while keeping `concept` raw. A mechanical guard now reads every component and fails on a raw
identity interpolated into JSX (React keys exempt), seen to fail by reverting the rail.

The source layer changed with it: the scaffold skill authors human card headings and the app derives the
slug, the same split the course title uses. That is not cosmetic — a slugger destroys casing, so `KPI`
and `E46` are unrecoverable, and `e46-drift-target-spec` humanising to "E46 Drift Target Spec" only
works because the slug happened to preserve digits. Legacy courses are display-only affected; no
migration, and no acronym dictionary.

Verified in the browser on the owner's own `string-box-alignments`, which still holds slug card names:
rail, breadcrumb, heading, module titles, tray and telemetry table all read human text, and a page-wide
scan found no slug token. Tests: 134 server, 94 client.











## 2026-09-13 19:34 — **Changed:** Part 3e replaced by Part 5 (display + source + honesty about casing...
**Changed:** Part 3e replaced by Part 5 (display + source + honesty about casing loss).
**Verified:** the slug names are authored by the scaffold skill into `SCHEMA.md` and flow through `Unit.title`/`Module.title`/tray/table unchanged; `course-model.ts:221-223` embeds the raw concept name in the module titles.
**Next:** paste Part 5 in place of 3e and send. If you want a smaller round, Part 5 is also self-contained enough to ship on its own ahead of Parts 2 and 4.
## 2026-09-13 19:35 — **Changed:** web/src/humanize.ts (new, one pure function); humanize applied at 1...
**Changed:** web/src/humanize.ts (new, one pure function); humanize applied at 14 render sites across 8 components plus 2 model-built display strings; scaffold skill + SCHEMA template now author human concept headings; component guard against raw identifiers reaching JSX; TASKS T-052..T-055 done; PLAN.md P17 and PROGRESS.md updated
**Verified:** 134 server + 94 client tests pass, tsc clean, vite build ok; browser check on your own string-box-alignments (slug cards on disk) — rail, breadcrumb,...
## 2026-09-13 19:24 — **Changed:** Part 3e replaced by Part 5 (display + source + honesty about casing...
**Changed:** Part 3e replaced by Part 5 (display + source + honesty about casing loss).
**Verified:** the slug names are authored by the scaffold skill into `SCHEMA.md` and flow through `Unit.title`/`Module.title`/tray/table unchanged; `course-model.ts:221-223` embeds the raw concept name in the module titles.
**Next:** paste Part 5 in place of 3e and send. If you want a smaller round, Part 5 is also self-contained enough to ship on its own ahead of Parts 2 and 4.
## 2026-09-13 18:23 — **Changed:** nothing (investigation; created `wheel-building-and-truing`, added ...
**Changed:** nothing (investigation; created `wheel-building-and-truing`, added one turn to `string-box-alignments`).
**Verified:** the full flow driven in a real browser with screenshots in `/tmp/socshots/`; the rename verified on disk; the refresh failure, sticky error, raw markdown, internals narration and skill-leak all reproduced live; browser closed, no daemons left.
**Next:** decide whether to take the rename/refresh fix before the isolation work — and tell me if you want both test cou...
## 2026-09-13 17:48 — **Changed:** nothing (lesson proposals awaiting your approval)
**Changed:** nothing (lesson proposals awaiting your approval).
**Verified:** the existing entry formats in both files, and that GL-028 is the current highest harness number.
**Next:** say which you want and I'll hand you the exact edit — or add them yourself, since `LESSONS.md` is gitignored and yours.
## 2026-09-13 17:45 — **Changed:** MISSION.md's H1 is the course title (H1 → destination → dir fallbac...
**Changed:** MISSION.md's H1 is the course title (H1 → destination → dir fallback, legacy prefix stripped, COURSE.md title source removed); PATCH rename with validation and pre-write collision check; one reconcile mover that renames the directory, emits {type:"renamed"}, follows on the open page, goes through the bridge for the active course and defers mid-turn; EditableTitle on the course page and library card; scaffold skill Step 7 with the seeded-subject guard; watcher reconciles MISSION.m...
## 2026-09-13 17:25 — **Changed:** F5/F6 revised — real store instead of temp store, with attribution ...
**Changed:** F5/F6 revised — real store instead of temp store, with attribution as the requirement and a mandatory cleanup so your first articulation is still yours.
**Verified:** `storeRoot()` reads `SOCRATES_HOME` purely as a path override (`course-store.ts`), so a temp store adds no coverage — which is what made your objection correct.
**Next:** send it. When it reports, I'll check the before/after directory listings and the SSE frame before you start your own run.
## 2026-09-13 17:15 — **Changed:** F5/F6 revised — real store instead of temp store, with attribution ...
**Changed:** F5/F6 revised — real store instead of temp store, with attribution as the requirement and a mandatory cleanup so your first articulation is still yours.
**Verified:** `storeRoot()` reads `SOCRATES_HOME` purely as a path override (`course-store.ts`), so a temp store adds no coverage — which is what made your objection correct.
**Next:** send it. When it reports, I'll check the before/after directory listings and the SSE frame before you start your own run.
## 2026-09-13 17:13 — **Changed:** harness guard now refuses any factory-less *.ts in agent/extensions...
**Changed:** harness guard now refuses any factory-less *.ts in agent/extensions/ (pushed as 610f05b); GL-027 restated by mechanism; store archived to ~/.socrates/archive/20260913T165342; empty-library copy rewritten; six DECISIONS sections superseded plus CONTENT-MODEL/HANDOFF-ANALYSIS/TASKS/server-header; /api/stream handshake instrumented; T-051 closed as a misdiagnosis; packaging gap recorded
**Verified:** origin/main == 610f05b (0 ahead / 0 behind); canary REFUSED exit 1 then guard 50/50...
## 2026-09-13 17:03 — **Changed:** harness guard now refuses any factory-less *.ts in agent/extensions...
**Changed:** harness guard now refuses any factory-less *.ts in agent/extensions/ (pushed as 610f05b); GL-027 restated by mechanism; store archived to ~/.socrates/archive/20260913T165342; empty-library copy rewritten; six DECISIONS sections superseded plus CONTENT-MODEL/HANDOFF-ANALYSIS/TASKS/server-header; /api/stream handshake instrumented; T-051 closed as a misdiagnosis; packaging gap recorded
**Verified:** origin/main == 610f05b (0 ahead / 0 behind); canary REFUSED exit 1 then guard 50/50...
## 2026-09-13 16:50 — **Changed:** directive updated (adds the clean-slate/loadable-app scope, the nin...
**Changed:** directive updated (adds the clean-slate/loadable-app scope, the nine-gate handoff intent, and Scope 6 deferral).
**Verified:** `origin/main` = `e1ef2fc` so exactly one commit is unpushed; the guard's `.test.ts`-only condition; the four ADR line refs; the store holding only `the sample course`; nothing listening on any app port; the p16 screenshot's "2 courses".
**Next:** send it. Then run the nine gates yourself — start with loading the app and articulating a subject, since that's the p...
## 2026-09-13 16:30 — a course is a subject, not a folder

Deleted the discovery stack rather than deprecating it: `courses.ts` (scan, registry, pin/label/hide,
`initiated`), `fs-browse.ts` and the folder picker, the registry POST branches, the T-041 `/init`
route, the T-044 started-but-not-scaffolded copy, and `defaultCourseId()` — with no `PROJECT_DIR`
there is no default course, so `POST /api/chat` requires one and says so. `CourseRef`, `courseRefs()`
and `findCourse()` moved into `course-store.ts`; `ManageCourses` is now a single "what is the
subject?" form that dispatches `/skill:scaffold-learning` through the same `askHref` mechanism as the
grill. Tests went 137 -> 111 server and 83 -> 85 client: the deleted suites left with their code.

Running it against a real agent surfaced two defects that unit tests could not. A throw in any route
handler left the request open forever, so every `/api/courses/:id` request hung after `findCourse`'s
signature changed under its callers — the router body is now a named function whose errors answer
500. And the `[ERROR]` stream frame was rendered verbatim, putting `{"error":"pi process exited"}` in
front of the learner; `streamErrorText` unwraps it and shows non-JSON as it arrived.

The articulate flow itself works end to end: a subject typed into the form becomes
`~/.socrates/courses/<slug>`, the tutor runs the scaffold skill, reads the seeded MISSION.md stub and
asks interview Q1. **T-051 is open and reproducible**: the settle frame for a long, tool-heavy turn
never reaches the client, so the composer stays disabled forever while the server reports the turn
settled. Separately, the harness had a live cross-project outage — a `*.test.ts` in
`agent/extensions/` was loaded as a global extension, so pi refused to start anywhere (GL-027).





## 2026-09-13 16:31 — **Changed:** deleted codebase/citations + scan/registry/folder-picker; added one...
**Changed:** deleted codebase/citations + scan/registry/folder-picker; added one store and the subject-first entry point; fixed hanging requests and raw-JSON errors; repaired a pi-wide startup outage in the harness
**Verified:** 111 server + 85 client tests, typecheck, vite build; articulate flow end to end on a real agent (screenshot); default-store run with /api/fs 404 and registry actions gone; harness guard 50/50 with the new rule seen to fail; the sample course md5s unchanged; no listeners or s...
## 2026-09-13 16:07 — **Changed:** nothing (direction review + directive)
**Changed:** nothing (direction review + directive).
**Verified:** the sample course's course is already `kind: topic` (`/api/courses/the sample course` returned `kind: topic, derived: true`), so dropping `codebase` doesn't touch your actual course; the scan/`COURSES_ROOT`/registry machinery is confirmed present in `courses.ts` and `server.ts`.
**Next:** send it. The deletions are the bulk of the work and they make the app smaller — but note the floors in `run-extension-tests.mjs` will need lowering as tes...
## 2026-09-13 15:59 — Two bugs, and the second is the more serious: `findCourse`'s signature changed b...
Two bugs, and the second is the more serious: `findCourse`'s signature changed but its callers didn't, and an unhandled throw in a route **hangs the request forever** instead of returning 500. Fixing both:
## 2026-09-13 15:46 — **Changed:** nothing (direction review + directive)
**Changed:** nothing (direction review + directive).
**Verified:** the sample course's course is already `kind: topic` (`/api/courses/the sample course` returned `kind: topic, derived: true`), so dropping `codebase` doesn't touch your actual course; the scan/`COURSES_ROOT`/registry machinery is confirmed present in `courses.ts` and `server.ts`.
**Next:** send it. The deletions are the bulk of the work and they make the app smaller — but note the floors in `run-extension-tests.mjs` will need lowering as tes...
## 2026-09-13 14:58 — **Changed:** `socrates-web main` → `4be7317` (`transcript.ts`, LessonPage transc...
**Changed:** `socrates-web main` → `4be7317` (`transcript.ts`, LessonPage transcript + synchronous settle, `theme.css` `.msg-user`, 4 tests, 2 screenshots, TASKS T-050, plan/TASKS citation fixes). `pi-agent-harness` branch `passivity-emitter` → **PR #6 open**.
**Verified:** `npm test` **119 server + 80 client**; harness **35 learning + 6 passivity**; `tsc --noEmit` and `vite build` clean; the raw RPC frame and the negative case; browser verification of both features against the real bridge; n...
## 2026-09-13 17:25 — the four features dropped in the P2 cutover are recovered
Recovered from `06cee66^:public/app.js` (the audit was a lead, not the source) and rebuilt in React, one
commit each: grill-misconception dispatch, the cognitive sprint rest gate, the passivity intercept, Budapest
mode. Two audit errors were confirmed against the source and NOT reproduced: the old rest-gate overlay was
`rgba(17,17,17,0.55)` with no `backdrop-filter`, and the passivity banner never blocked submission.
**Verified:** all four browser-verified. The grill dispatched against the real bridge (7,754 chars of reasoning
in the drawer) and a reload sent nothing; the rest gate froze the composer and, after the 5:00 countdown was
**waited out in full**, released it; the passivity intercept refused "ok" and accepted a real explanation, then
cleared; Budapest posted `mode:"budapest"` with an unpolluted message while the server injected the modifier.
119 server + 76 client tests pass.
**Found:** the grill's URL strip wrote the COURSE route instead of the lesson (a refresh would have landed on the
wrong screen); the rest gate's token detection was fixed to survive a token split across two deltas; the lesson
console never renders the learner's own message (T-050, recorded).
**Next:** T-050, T-044, T-042, T-034 — all tracked and unbuilt.




## 2026-09-13 14:52 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** original dispatch is `/skill:grill-misconception` (colon) at `app.js:84`; new code matches (`grill.ts:16`, `ui.test.ts:951-972`); all cited old lines printed; `PASSIVITY` absent from `~/.pi/agent/extensions/`.
**Next:** paste it. The recovery work itself is sound — the report's slash/colon slip and the 182-vs-179 cite are transcription errors, not code defects, which is a good sign about where the errors now live.
## 2026-09-13 14:32 — **Changed:** nothing (verification + two paste-ready prompts)
**Changed:** nothing (verification + two paste-ready prompts).
**Verified:** all eight implementation commits exist in `socrates-web` with matching messages (`git log -1` per SHA); HEAD is `12ea537`.
**Next:** send the first block to NotebookLM and close that thread; hand the second to the implementation agent. The audit's *finding* is real and worth acting on — its *citations* aren't, so don't let the document drive the build.
## 2026-09-13 14:22 — **Changed:** nothing (verification + two paste-ready prompts)
**Changed:** nothing (verification + two paste-ready prompts).
**Verified:** all eight implementation commits exist in `socrates-web` with matching messages (`git log -1` per SHA); HEAD is `12ea537`.
**Next:** send the first block to NotebookLM and close that thread; hand the second to the implementation agent. The audit's *finding* is real and worth acting on — its *citations* aren't, so don't let the document drive the build.
## 2026-09-13 15:55 — P8: the grading contract no longer punishes correct answers
Quiz items now carry a `mode`. `short-answer` (auto-graded) requires ≤ 6 words / ≤ 60 chars / one sentence,
and a longer answer WITHOUT `mode: self-check` is rejected — auto-grading prose marked correct paraphrases
wrong, and a false negative is worse than a false positive in a learning tool. `self-check` reveals the
solution and the learner judges their own answer. Authored items obey the same rule; the generation prompt
demands short checkable answers and documents the escape. Normalisation now folds quotes, dashes, case and
trailing punctuation while KEEPING internal punctuation.
**Verified:** `STATUS = 'APPROVED'.` graded correct (the reported bug); a self-check item never auto-grades,
reveals the solution, and locks only on the learner's verdict; completion reported 4 of 4.
**Bug found while verifying:** "Show solution" revealed the verdict buttons but not the solution itself — the
steps were still gated behind `state.locked`, asking the learner to judge without seeing the answer.
**Lessons:** GL-024 extended (a bare `catch {}` upstream of a success report is the same failure mode) and
GL-025 added (a rewrite can silently drop behaviour an earlier phase verified — re-run earlier criteria).
**Next:** T-044 (a started-but-empty course looks broken), T-042 (validation limit), T-034 (derived signal) —
all tracked and unbuilt.


## 2026-09-13 14:19 — **Changed:** `socrates-web main` → `12ea537`: `assessments.ts` (`mode`, limits, ...
**Changed:** `socrates-web main` → `12ea537`: `assessments.ts` (`mode`, limits, `isAutoGradable`, rejection, prompt), `course-model.ts` (`- **mode:**`), `web/src/assessment-types.ts` (mode + rewritten normaliser), `quiz.ts` (`reveal`/`judge`, `check` refuses prose), `QuizPage` self-check path + the reveal fix, `docs/CONTENT-MODEL.md` (grading contract), `course-codebase` fixture gains a self-check item, 3 screenshots, TASKS/PROGRESS. Harness `LESSONS.md`: GL-024 extended, GL-025 added.
**Veri...
## 2026-09-13 15:10 — Real-data run, assessment loop closed, start-a-course shipped
**Real data:** the whole stack ran against a COPY of the sample course's `.agent/learning` (source md5s unchanged
before and after): catalogue showed exactly 1 course with 5 units, a real pi turn streamed into the lesson and
the extension wrote badge/SM-2/misconception through to SCHEMA.md, the tray rendered the real MIS-001, and a
real-agent-generated quiz was taken to completion.
**Found and fixed:** the watcher fired and the server re-parsed, but the UI never heard about it — the client
had no consumer for `reload`, and the only SSE channel carries a chat turn with a SINGLE subscriber. Added
`/api/watch`; writing SCHEMA.md on disk now updates the open course page's ring with no navigation.
**T-043:** an attempt now moves a badge via a DERIVED rule (the design's gate copy), raise-only, logged as a
`badge` event that the extension's own projection applies on the next session. SM-2 deliberately untouched.
**T-041:** "Start course" writes MISSION.md from the user's own words; the catalogue went 1 → 2 courses.
**Also:** `expr.ts` purity guard (seen to fail before being trusted); GL-024 and the GL-022 browser variants.
**Next:** T-042 (validation cannot catch a wrong-but-well-cited item) and T-034 (derived persistence signal)
stay tracked and unbuilt.


## 2026-09-13 14:02 — **Changed:** `socrates-web main` → `8d269f6`: item 1 `5451d3c` (`/api/watch`, `w...
**Changed:** `socrates-web main` → `8d269f6`: item 1 `5451d3c` (`/api/watch`, `web/src/watch.ts`, CoursePage reload, expr purity guard), item 2 `6562959` (`awardedBadge`/`raisesBadge`, badge event, `pendingBadge`, `docs/CONTENT-MODEL.md`, 13 tests), item 3 `8d269f6` (`startCourse`, `/init` route, manage-panel form, 2 tests), 6 screenshots, TASKS/PROGRESS. `pi-agent-harness main` → `e9df30b` (PR #5 merged).
**Verified:** all raw output above; **110 server + 53 client** tests; `tsc --noEmit` an...
## 2026-09-13 14:05 — P6 complete: interactives and games; P5 completion claim corrected
`#/lab/:courseId/:unit` runs a function-plot **interactive** (draggable parameters) and a **target-window
game**, both driven by pure engines (`expr.ts` evaluator with no `eval`, `game.ts` timing logic) and both
authorable in `COURSE.md` or generatable under the same validation gate as assessments.
**Verified:** browser-verified — plot draws 161 points, `m` and `b` both move the curve, the marker sweeps with
both outcomes reachable (2 hits / 13 misses over 15 launches), reduced motion detected and disclosed, and the
frame loop cancelled on leave (179 rAF calls on the lab → 0 after navigating away).
**Also fixed:** the quiz completion screen claimed "Skill moved to Proficient" while nothing computed or wrote a
mastery change. Now the attempt is POSTed and appended to `events.jsonl` as an `assessment_result` event, and
the screen claims only the score and the recording; a mastery line renders only when the response carries one.
**Recorded:** GL-023 (cleanup follows ignore rules, never directory names — a `find -name SESSIONS` deleted a
committed fixture) and the GL-022 SPA variant (opening the URL a SPA is already on is a no-op).
**Next:** P7 or the backlog — T-041 (start-a-course affordance), T-042 (validation cannot catch a
wrong-but-well-cited item), T-043 (no projection consumes `assessment_result` yet).



## 2026-09-13 13:52 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** the P5 fix is source-backed (`assessment_result` append + completion view-model tests + browser output showing `masteryLine:false`); the expr.ts server-import is confirmed in the P6 change list; the indentation bug is the third silent-parser-drop (previously `[a-z]+` and the 88-dash separator).
**Next:** paste it. Item 1 is the one I care about most — everything to date has been verified against fixtures, and the real the sample course cont...
## 2026-09-13 13:32 — **Changed:** `socrates-web main` → `58c7229` (30 paths): `assessments.ts` + 11 t...
**Changed:** `socrates-web main` → `58c7229` (30 paths): `assessments.ts` + 11 tests, `server.ts` (assessments routes + `runTurn`), `course-model.ts` (authored quiz sections), `process-bridge.ts` (`offLine`), `web/src/quiz.ts`, `assessment-types.ts`, `QuizPage.tsx`, router/App/CoursePage wiring, 32 client tests, `test/mock-pi-assessment.mjs`, `test/fixtures/course-codebase{,-empty}/`, 4 screenshots, TASKS/PROGRESS, `.gitignore`.
**Verified:** all raw output above; real-agent generation with r...
## 2026-09-13 13:35 — P5 complete: assessments (authored, else generated and validated)
Quiz items are authored inline in `COURSE.md` (`## Quiz: <title>` with answer/accepts/hints/steps/cites) or
generated by the tutor, and **nothing is served unless it validates** — the same gate for both paths. For a
`codebase` course an item must cite a real repository file, line anchors included. Generated items cache to
`ASSESSMENTS/unit-N.json`.
**Verified:** a REAL agent generated two codebase-grounded items citing `src/migrations/001_policy.sql#L2/L3/L4`
(0 rejected); every UI branch browser-verified — incorrect, hints 1/3→3/3, the two-mistake gate with both
choices, correct with the step solution and citation, and completion. Failure paths verified in the browser:
no JSON block → "This quiz could not be prepared" with the reason and no quiz rendered; a nonexistent citation →
`citation-not-found:…`. 91 server + 32 client tests pass.
**Self-inflicted:** an over-broad fixture cleanup (`find -name SESSIONS -exec rm`) deleted the committed journal
fixture; restored with `git checkout` and verified. Cleanup must name runtime artifacts, not directory names.
**Next:** P6 — interactives and games.


## 2026-09-13 13:26 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** process cleanup confirmed independently (`Get-CimInstance` filtered on `server\.ts|pi-coding-agent|--mode rpc` → no real matches; 4 stray node processes are unrelated tooling).
**Next:** paste it. P5 is the last functional phase before interactives — the failure-path verification (invalid generation surfacing an error) is the one I'd want raw evidence for, since it's the easiest to skip.
## 2026-09-13 13:20 — P4 complete: course-switching bridge + chat-first lesson on the real agent
`switchCourse()` moves the singleton agent between courses (kill tree, warm respawn); `/api/chat` and
`/api/stream` take an optional course and refuse a stream for a course other than the live turn. The lesson
console streams from the real pi bridge with a Socratic Reasoning drawer.
**Verified** against a real agent on a temp root: the same prompt answered `…/course-taxonomy` then
`…/course-basic`, proving the switch (API: `switched: true`); the drawer held 17,183 chars of reasoning while
the prose held 2,120 and shared none of it; Exit Lesson returned to the originating unit with `paneScrollTop`
restored to 380. 80 server + 19 client tests pass.
**Found and fixed:** a stale bundle was being executed because `index.html` was cacheable — a rebuilt app was
invisible until a hard refresh, which can silently invalidate a verification. Cache headers added.
**Also found:** four orphaned `server.ts` processes and an orphaned pi agent survived port-based cleanup,
because `taskkill /PID /F` omits `/T` and only listeners were being enumerated (GL-020).
**Next:** P5 — assessments (authored, else generated and validated).


## 2026-09-13 13:15 — **Changed:** `socrates-web main` → `fddcb88` (17 paths): `process-bridge.ts` (`s...
**Changed:** `socrates-web main` → `fddcb88` (17 paths): `process-bridge.ts` (`switchCourse`, identity-guarded exit, split teardown), `server.ts` (course-aware chat/stream, cache headers), `bridge.test.ts` (+3), `server.test.ts` (+4), `test/mock-pi-cwd.mjs`, `web/src/{turn,scroll}.ts`, `LessonPage.tsx`, router/App/CoursePage lesson wiring, `ui.test.ts` (+6), 2 screenshots, TASKS (T-025/026/027/040 done, +T-041), PROGRESS.
**Verified:** all raw output above from real-agent turns; `npm test` 80...
## 2026-09-13 12:55 — Module taxonomy completed; discovery made intentional
Added the four missing module types (`course-challenge`, `primary-source`, `faq`, `ai-activity`) to the
vocabulary, the manifest parser (which rejected hyphenated names), the glyph table and the labels — vocabulary
and rendering only, no deferred screens. Separately, a course now **requires** `MISSION.md`: a directory where
the learning extension has merely run is no longer counted as a course, because it was never initiated.
**Verified:** with `COURSES_ROOT=<courses-root>` the catalogue shows exactly 1 course (the sample course) and
"Scanning <courses-root>"; a bare `.agent/learning` dir appears only under "Add or manage" as
"not initiated (no MISSION.md)"; all 13 module types browser-verified rendering with icon + label.
73 server + 13 client tests pass, `tsc --noEmit` and the build are clean.
**Next:** P4 — bridge restart on course switch + the chat-first lesson on the real pi bridge.

## 2026-09-13 12:40 — P3 complete: journal endpoint, continue strip, add/manage courses
`journal.ts` reads a course's `SESSIONS/` projection (plus `events.jsonl` for counts only, so the client is
not coupled to the writer's schema) behind `GET /api/courses/:id/journal` and `.../journal/:file`; `CourseRef`
now carries `sessions: { count, lastAt }` parsed from file names. The continue strip exists at last, backed
**only** by the journal — and renders nothing when there is no journal. Add/hide/unhide work from the UI;
search gives a real no-results state.
**Verified:** browser-verified with agent-browser — registered a course outside the scan root from the form
(registry written, `fromScan: false`), Hide removed it from the grid but kept it in the manage list, Unhide
restored it, no-results panel + Clear filters worked, journal panel showed 2 real sessions, and the strip was
checked both with a journal and against a no-journal root. 68 server tests + 11 client tests + `tsc --noEmit`
+ build all pass.
**Note:** a test-time registry file reached `test/fixtures/course-with-journal/.agent/courses.json` before I
caught it — that path is now gitignored alongside the other fixture runtime artifacts.
**Next:** P4 — bridge restart on course switch + the chat-first lesson on the real pi bridge.




## 2026-09-13 13:05 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** the `[a-z]+` claim matches the parser change; the "1 course" claim I had independently confirmed earlier via live `GET /api/courses` against `<courses-root>`; not-initiated exclusion is backed by the temp-root run (9 cards, 2 uninitiated).
**Next:** paste it. P4 is where the real pi bridge finally gets wired to the UI — that's the phase I'd most want to see raw evidence for (a real streamed turn, not a mock).
## 2026-09-13 12:34 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** P2 acceptance criteria map to the agent's raw browser output (catalogue counts vs `masteryCounts`, rail swap, `aria-current` flip, ring stroke/dasharray change, tray MIS-003 ×1); the alias-removal claim is backed by `GET /api/learning → 404` + `GET / → 200` + `deepEqual` test.
**Next:** paste it. P3 is small, so the journal endpoint should land with it — I'd want the strip's data source visible (what it reads, what it shows) in the s...
## 2026-09-13 12:09 — **Changed:** `socrates-web main` → `06cee66` (34 paths: `web/` app + `web/dist` ...
**Changed:** `socrates-web main` → `06cee66` (34 paths: `web/` app + `web/dist` gitignored, `public/` deleted, alias removed, `courses.ts` +`masteryCounts`, `server.ts` +`staticDir`, `server.test.ts`, `test/fixtures/course-duplicate-misconceptions/`, `docs/ui-shots/` ×2, PLAN/TASKS); `pi-agent-harness main` → `188eb49` (PRs #3, #4 merged); global `LESSONS.md` (GL-001 process rule).
**Verified:** all raw output above; `npm test` 54/54; `tsc --noEmit` clean; `vite build` clean; the sample course rever...
## 2026-09-13 12:20 — P2 complete: Vite + React UI on real data, cutover done
Replaced the vanilla dashboard with `web/` (React 19 / Vite 8 / strict TS): hash router, catalogue, two-pane
course browser, telemetry rail. Home is deliberately sparse — no streaks/levels/ep/badges/subject chips, and
**no continue strip**, because recency needs the session journal which has no endpoint yet. The misconception
tray collapses to one row per id; a new `course-duplicate-misconceptions` fixture (MIS-003 ×3) proves it.
**Verified:** browser-verified with agent-browser on both the Vite dev server and the built bundle served from
Node — catalogue from real data (8 courses, counts summed from `masteryCounts`), course switch replacing the
whole unit rail, unit selection updating heading + breadcrumb + `aria-current` + ring + module pane, and the
tray rendering `MIS-003` ×1 with root/partial/unrated/resolved ordering. `public/` and the `/api/learning`
alias were deleted together, **after** the built UI was verified. 54 server tests + `tsc --noEmit` + build all pass.
**Found:** a detached server from Sep 12 (PID 28772) was still holding port 3850 and silently serving the old
API — it made `/api/courses` look missing. Killed; worth checking ports before trusting an E2E result.
**Next:** P3 — add-a-course (scan + registry + POST + form).

## 2026-09-13 12:05 — P1 complete: content model + course discovery + multi-course API
Derivation (`course-model.ts`) takes one unit per SCHEMA concept card — spike evidence ruled out PLAN phases,
which recovered 2 of 5 concepts in one project and 0 of 4 in another — with an optional `COURSE.md` manifest
overriding it. `courses.ts` adds scan-first discovery plus a registry overlay. `server.ts` gained
`/api/courses*` routes and an exported `startServer()` (no import side effects); `/api/learning` is asserted
byte-identical to `parseLearning()`.
**Verified:** 54 tests pass (was 9); 7 vendored fixtures under `test/fixtures/` so no test needs an external
project; end-to-end against a temp copy — 7 courses discovered, manifest override honoured, alias byte-equal,
register/hide/unregister work, and **no pi spawned**.
**Deviation to remember:** my first E2E ran the server with `PROJECT_DIR` pointing at a committed fixture and
chat enabled, so `startServer` spawned pi at boot and the global extensions wrote an event log with absolute
paths into the fixture — which I then committed. Fixed the root cause (bridge now wires on the first chat
request), added a regression guard, gitignored fixture runtime artifacts, and removed the files. They remain
in `d6e4145`'s history; history was not rewritten per the standing instruction.
**Next:** P2 — Vite + React scaffold, real-data catalogue and course browser, telemetry rail with the
tray collapsed to one row per misconception id.









## 2026-09-13 12:00 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** `d6e4145` history retains only path/session metadata (no credentials), and the name is already public via the profile — so no force-push is warranted; harness PRs #3/#4 are the only pending global changes.
**Next:** paste it. P2 is the largest phase and the one that deletes the old UI — I'd want to see the browser screenshots (catalogue, course switch, tray dedupe) with the single P2 report.
## 2026-09-13 11:38 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** identity exposure assessed via `git log --format='%an <%ae>'` (both repos = pseudonym + GitHub noreply → metadata clean) and `gh api users/LabidySabidy` (profile name public → history rewrite pointless).
**Next:** merge #3, paste this, then P1 — where I'd want the derivation rules + `docs/CONTENT-MODEL.md` before any code.
## 2026-09-13 11:33 — **Changed:** `socrates-web` `main` → `faf6933` (unpublish memory + screenshots, ...
**Changed:** `socrates-web` `main` → `faf6933` (unpublish memory + screenshots, account-name scrub, portable parser test) and `d897c0c` (T-033 limitation note); `.gitignore` (+3 rules).
**Verified:** `git ls-files` → 16 files, none containing the account name; `git check-ignore -v` → `.gitignore:19/20/23` for the three unpublished paths; `npm test` → 9 pass / 0 fail; the sample course mtime + artifact listing + 6-column header above; `gh pr view` → #3 `base=main`, #4 `base=p0-telemetry-durability`.
...
## 2026-09-13 11:32 — **Changed:** nothing (review + reply prompt)
**Changed:** nothing (review + reply prompt).
**Verified:** repo visibility confirmed via `gh repo view` (both PUBLIC); PR #3 base=main, PR #4 base=p0-telemetry-durability, both OPEN and non-draft.
**Next:** merge #3, paste this, then P1 — at which point I'd want the derivation rules + `docs/CONTENT-MODEL.md` before code.
## 2026-09-13 11:16 — **Changed:** nothing (design call + reply prompt)
**Changed:** nothing (design call + reply prompt).
**Verified:** the severity source is tutor-emitted to stay consistent with the project's no-invented-data rule; the schema change is flagged as shared-format (extension + parser must land together).
**Next:** merge PR #3, paste this, then P1 begins — at which point I'd want to see the updated `SCHEMA.md` table spec and the derivation rules before code.
## 2026-09-13 10:23 — **Changed:** `~/.pi` → `07656d9` pushed, PR #3 un-drafted (`gh pr ready`); `sche...
**Changed:** `~/.pi` → `07656d9` pushed, PR #3 un-drafted (`gh pr ready`); `schema.ts` (+duplicate warning), `signal.ts` (+`countUserPrompts`), `index.ts` (`turn_end` handler removed, turns from user prompts), 2 new tests (30 total); `socrates-web/docs/EVENT-SCHEMA.md` (new); global `LESSONS.md` (+GL-018); project `LESSONS.md` (GL-018 pointer, schema-doc pointer); `PROGRESS.md` (P0 complete).
**Verified:** `node --test` → 30 pass / 0 fail; fresh `pi -p` read-back showing `turns: 1` and the du...
## 2026-09-13 10:20 — **Changed:** nothing (generated a reply prompt)
**Changed:** nothing (generated a reply prompt).
**Verified:** the four directives map 1:1 to the review findings; T-009 status and the no-merge rule are consistent with the standing directive.
**Next:** paste it, then P0 closes and P1 (content model + API surface) begins — that's where I'd want to see the derivation rules and `docs/CONTENT-MODEL.md` before code.
## 2026-09-13 10:10 — **Changed:** nothing (generated a reply prompt)
**Changed:** nothing (generated a reply prompt).
**Verified:** the four directives map 1:1 to the review findings; T-009 status and the no-merge rule are consistent with the standing directive.
**Next:** paste it, then P0 closes and P1 (content model + API surface) begins — that's where I'd want to see the derivation rules and `docs/CONTENT-MODEL.md` before code.
## 2026-09-13 02:26 — P0 mid-flight: pure learning modules landed on a branch, nothing verified end to end
Handoff analysis complete (`docs/HANDOFF-ANALYSIS.md`, 6 reference screenshots) and all 7 Platform decisions +
2 architecture decisions recorded in `DECISIONS.md`; `PLAN.md` rewritten to P0–P6 and `TASKS.md` to T-001–T-031.
P0 (telemetry durability / DEF-001) is a **separate workstream in the `pi-agent-harness` repo** — T-001 landed as
commit `19afbcc` on branch `p0-telemetry-durability` (PR #3, **draft, unmerged**): pure `telemetry.ts`,
`events.ts`, `schema.ts` + 17 passing tests, inert because pi resolves `extensions/<dir>/` only via
`index.ts`/`index.js`/manifest (verified empirically against the real loader).
**Verified:** 17/17 tests pass; loader fixture proves `learning/*` resolves to nothing without `index.ts`.
**Next:** **P0 is complete and verified.** T-002–T-008 landed in `e9000af`; the T-009 read-back ran in a
throwaway `learning-demo` copy via fresh `pi -p` processes and found a real bug (`telemetry_missing` firing
per agent turn rather than per run → fixed in `a577886`); review directives 1–4 landed in `07656d9`. PR #3 is
**ready for review** (4 commits, +1665/−368). Next workstream is **P1 — content model + API surface** (T-010–T-016).









## 2026-09-13 02:44 — **Changed:** `~/.pi` branch `p0-telemetry-durability` → `a577886` pushed (3 comm...
**Changed:** `~/.pi` branch `p0-telemetry-durability` → `a577886` pushed (3 commits, 10 files, +1599/−368, PR #3 still draft); `socrates-web/TASKS.md` (T-009 done + known limitation).
**Verified:** all raw output above — one fresh `pi -p` process per phase, cwd = throwaway `learning-demo` copy; source SCHEMA.md md5 `c8e42119f4d3fb5532b678ec19c8dc30` unchanged; `node --test` → 28 pass / 0 fail; `gh pr view 3 --json` → `state OPEN, isDraft true`.
**Next:** your event-schema + projection review ...
## 2026-09-13 02:40 — **Changed:** nothing (read-back guidance)
**Changed:** nothing (read-back guidance).
**Verified:** the fixture-mutation risk is real — the read-back writes badges/SM-2/MIS into `SCHEMA.md`, which is the same file the derivation model reads.
**Next:** run the read-back from a `learning-demo` copy and return the raw artifacts.
## 2026-09-13 02:11 — **Changed:** `DECISIONS.md` — added 2 ADR entries (event-sourced 3-layer learnin...
**Changed:** `DECISIONS.md` — added 2 ADR entries (event-sourced 3-layer learning state, per course; course.kind topic|codebase).
**Verified:** `tail -3 DECISIONS.md` before edit to anchor exact text; edit applied (1 block replaced); extension API facts previously read from `dist/core/extensions/types.d.ts` (`session_start`/`agent_end`/`session_shutdown`, `ctx.sessionManager`, tool registration).
**Next:** confirm the 3 defaults (or override), then I write `PLAN.md` starting at P0.
## 2026-09-13 02:11 — **Changed:** nothing (revised a prompt)
**Changed:** nothing (revised a prompt).
**Verified:** handoff folder contents listed (`README.md`, 2 `.dc.html`, `support.js`); README's own "design reference, not production code" rule confirmed and reflected.
**Next:** paste it with the handoff path. The agent's first two outputs — the separation note and the content-model spike — are what I'd review before it writes any real code.
## 2026-09-13 02:01 — **Changed:** nothing (revised a prompt)
**Changed:** nothing (revised a prompt).
**Verified:** handoff folder contents listed (`README.md`, 2 `.dc.html`, `support.js`); README's own "design reference, not production code" rule confirmed and reflected.
**Next:** paste it with the handoff path. The agent's first two outputs — the separation note and the content-model spike — are what I'd review before it writes any real code.
## 2026-09-13 01:46 — **Changed:** nothing (generated a fresh prompt)
**Changed:** nothing (generated a fresh prompt).
**Verified:** every requirement from the approved plan is represented; medium-specific constraints (no build, canvas globe, hash routing, mock stream) added for the Claude artifact environment.
**Next:** paste it. When it returns, send me the artifact + its summary and I'll run the review pass.
## 2026-09-13 00:40 — **Changed:**
- Pushed `f634776` to `origin/main` (bundled-pi commit + docs + loc...
**Changed:**
- Pushed `f634776` to `origin/main` (bundled-pi commit + docs + lockfile).
- Started socrates-web as a detached process (PID 28772) on **http://localhost:3850**, `PROJECT_DIR=<the the sample course course dir>`.

**Verified:**
- `/health` → `ok`
- `/api/learning` → 3 files present, 5 concepts, real mission text
- `/` → `200 text/html`
- Server process alive (`HasExited=False`), logs clean, stderr empty.

**Next:** Open http://localhost:3850 in your browser. To stop it: `Stop-Process -Id 2...
## 2026-09-12 16:24 — **Changed:**
- `package.json` + `package-lock.json` — added `@earendil-works/pi-...
**Changed:**
- `package.json` + `package-lock.json` — added `@earendil-works/pi-coding-agent@^0.85.1` (published, bin `pi → dist/bundle/cli.js`).
- `process-bridge.ts` — default spawn is now `node <bundled-pi-cli> --mode rpc`, resolved via `import.meta.resolve` (needed because the package is ESM-only — `require.resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`). Dropped the Windows `.cmd` shell wrapper; `PI_BIN`/`PI_ARGS` retained as test escape hatch.
- `PLAN.md` / `.gitignore` — removed stale...
## 2026-09-12 16:08 — Understood — two corrections accepted and one real gap surfaced
Understood — two corrections accepted and one real gap surfaced.

**Corrections locked in:**
- `PROJECT_DIR` is required, not optional. Points at the the sample course course dir (the dir holding `.agent/learning/`). Without it, cwd = socrates-web → `/api/learning` returns an empty structure (no error, but zero concepts/mission).
- Port is 3850. The 3847 in the old log was the pre-rename "study-dashboard" build.

**The pi-bundling point is the real issue.** Current state:

- `process-bridge.ts` sp...
