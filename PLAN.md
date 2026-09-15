# Plan — A tutor turn that fails must say so, and a capture must not lie

> Active work plan. Supersedes the P16/P17 head of this file; those are complete and in git.

## Goal
Two reported defects stop being invisible: when the tutor's provider fails, the learner is told what happened
instead of watching an unbounded "thinking" spinner; and the DOM capture paints every element where it
actually appears instead of offset by the scroll position.

## Approach

**Defect A — the failure was never reaching the screen, not a broken tutor.** The owner filed "socratic
thinking broken" twice. The tutor was never the problem: pi recorded
`"stopReason":"error","errorMessage":"We were unable to start processing your request within the 900-second
timeout limit"` **four times**, ~906s apart, and the app rendered nothing because `server.ts` consumes only
`text_delta` events and `grep -rn "errorMessage\|stopReason"` across `server.ts`, `process-bridge.ts` and
`web/src/` returned **zero hits**.

**The mechanism is traced from pi's source, with line numbers** (see `.agent/grill/tutor-failure-and-capture.md`):

- `agent-session.js:706-714` emits `auto_retry_end {success: false, finalError: msg.errorMessage}` when it
  stops retrying. **This is the terminal failure, carrying the provider's own text, fired exactly once.**
- `agent-session.js:2018-2024` emits `auto_retry_start {attempt, maxAttempts, delayMs, errorMessage}` per retry.
- `agent-session.js:418` — `message_update` carries **the whole `message`**, so the failed assistant message is
  *already on the wire*; the app throws it away by reading only `assistantMessageEvent.delta`.
- `settings-manager.js:555-557` — `maxRetries ?? 3`, `baseDelayMs ?? 2000`; `DEFAULT_HTTP_IDLE_TIMEOUT_MS` 900s.

**That closes the arithmetic on the 906s gaps exactly:** 4 empty records = initial attempt + 3 retries, each
idle against the provider for 900s, with only 2+4+8 = 14s of backoff.

The fix reads the failure pi already emits and carries it to the chat. This is a data-plumbing fix, not a
prompt fix, and it must not be allowed to become "make the tutor smarter".

**The CRITICAL risk is a second silent failure:** `auto_retry_end` is guarded by `_retryAttempt > 0`, so a
**first-attempt non-retryable error** (auth, bad model) emits NO retry events at all. The fix must therefore
read the failed message's `errorMessage` **as well as** `finalError`, and each path gets its own test seen to
fail first.

**Defect B — a double-counted scroll offset.** `capture.ts` computed `x = rect.left + scrollLeft` while
`getBoundingClientRect()` is already viewport-relative. Measured in a real browser: at `scrollTop 0` the error
is 0px, at `scrollTop 48` the error is 48px — every element painted 48px below where it belongs, which is the
doubled and overlapping text in the owner's screenshots. The fix is to stop adding the offset, and to read the
offset from the **actual scrolling container** rather than only `documentElement` (measured: the document's
`scrollTop` reported 48 while the lesson scrolls inside an inner pane, so a document-only fix would be wrong
for the real layout).

Both defects share one property worth naming: **they are silent.** A failed turn looked like a slow turn, and
a wrong capture looked like a broken app. That is why each fix carries a test that fails when the signal is
dropped, not merely a test that the happy path still works.

## Phases

1. **Defect A1 — surface the provider failure.** Read pi's failure events (`auto_retry_end`, `auto_retry_start`,
   and the failed message's `errorMessage`) in the turn handler, carry the message through the turn result, and
   render it in the chat with a **Retry** button. Bounding the wait at **180s** (owner's decision).
2. **Defect A2 — the outage experience.** A provider outage emits NOTHING on any channel for 900s, so the UI has
   nothing to stream and freezes on a static "thinking". Give the turn a visible clock and an explicit
   liveness state, so a dead provider is distinguishable from a slow one before the 180s ceiling — which is
   what "the app needs to feel alive" actually requires.
3. **Defect B — paint at the measured position.** Remove the double-counted offset; resolve the scroll origin
   from the nearest scrollable ancestor. Owner chose **option 2 (fix positioning)** over removing the fallback.

## Files that will change

| File | Change | Phase |
|---|---|---|
| `server.ts` | read `stopReason: "error"` / `errorMessage` and any abort record from pi's stream; return it on the turn result | 1 |
| `turn-result.ts` (new) | one place that classifies a turn outcome — text, provider error, timeout — so the classification is unit-testable without a live pi | 1 |
| `turn-result.test.ts` (new) | tests: a real error message is carried; an empty textless turn is NOT reported as success; a healthy turn is untouched | 1 |
| `web/src/types.ts` | carry the outcome on the turn/chat response shape | 1 |
| `web/src/components/LessonPage.tsx` | render the provider failure in place of the reply, with a retry, instead of an unbounded spinner | 1 |
| `web/src/failure.ts` (new) | classify a provider failure into learner-facing copy that names the cause and the next action | 1 |
| `web/src/failure.test.ts` (new) | tests: timeout, rate-limit, outage, auth and unknown each produce distinct copy; none leaks raw provider text | 1 |
| `web/src/liveness.ts` (new) | the turn's visible clock and liveness state — "working", "slow", "stalled" — so an outage is legible before the ceiling | 2 |
| `web/src/liveness.test.ts` (new) | tests: the state advances with elapsed time; a turn with recent deltas is never called stalled; a silent turn reaches the stalled state | 2 |
| `web/src/components/LessonPage.tsx` | render the failure + Retry, and the elapsed clock, in place of the bare spinner | 1,2 |
| `web/src/capture.ts` | drop the double-counted scroll offset; resolve the scroll origin from the nearest scrollable ancestor | 2 |
| `web/src/capture.test.ts` | tests pinning viewport-relative painting and the scrolled-container case (seen to fail against the current code) | 2 |
| `reports.ts` | record scroll position with the report | 2 |
| `docs/CONTENT-MODEL.md` | note the new turn-outcome shape | 1 |

## Acceptance criteria

- [ ] A turn whose pi stream carries `stopReason: "error"` returns that error, not an empty success.
- [ ] A **first-attempt non-retryable** error (no retry events at all) is ALSO reported — the CRITICAL risk.
- [ ] The failure appears in the chat with copy naming the cause, and a **Retry** button that re-sends the turn.
- [ ] A turn is reported at **180s** (owner's decision), not left until pi's 900s idle timeout.
- [ ] **The app feels alive during a stall:** elapsed time is visible from the first second, and a silent turn
      reaches a distinguishable "stalled" state before the 180s ceiling — so the learner is not watching an
      unchanging spinner during a provider outage.
- [ ] A turn that streams normally is never labelled stalled, and its text is never lost to a trailing failure.
- [ ] The capture paints elements viewport-relative: with the page scrolled, painted y equals `rect.top`
      (measured, not asserted by reading source).
- [ ] The capture resolves the scroll origin from the nearest scrollable ancestor, verified against the real
      lesson layout where the document reports a smaller scroll than the pane (owner chose option 2).
- [ ] The existing suite is unchanged in behaviour: 197 server / 188 client still pass, tsc clean, build green.
- [ ] Verified in the agent browser against the real course, with the before/after captured.

## Not in scope

- **Retrying the provider automatically.** The 906s retry loop is pi's; this plan makes the failure visible
  rather than changing retry policy, which is a separate decision.
- **Replacing the DOM capture with a true CSS renderer** (`html2canvas`-class). Out of bounds: it is a new
  runtime dependency and the project ships two.
- **Fixing `deepseek-flash` timeouts.** A provider-capacity problem, not an app defect. The app's job is to
  report it.
- **Teaching mode (Step 4) and the noise items (Step 6).** Separate, still open, unaffected by this.
- **Per-node CSS fidelity** — borders, radii, gradients, shadows. The capture states plainly what it does
  not reproduce; this plan does not widen that claim.

## Open questions

- **B1 — ANSWERED by owner: surface immediately with a Retry button.** No app-layer auto-retry. An automatic
  retry is how 45 minutes were lost without the learner knowing.
- **B3 — ANSWERED by owner: report at 180s.** With elapsed time shown, so a slow-but-working turn is not
  mistaken for a dead one.
- **B2 — record scroll position in the report?** Still leaning yes; one field, and its absence is why Defect B
  needed a browser probe. Not blocking.
- **NEW — does a Retry re-send the same prompt, and what happens to the partial text?** Leaning: re-send the
  same prompt, keep any streamed text visible but marked incomplete, and never duplicate a successful turn.
  Needs a test either way.

## Context added by the owner after the plan was written

The owner reports **deepseek was down for a few hours** — an outage, not a slow turn. That is the real-world
case behind both "stuck thinking" reports, and it upgrades this work: the requirement is not only "report the
failure" but "**the app must feel alive and responsive between actions**".

Measured consequence for the design: during an outage the tutor emits **nothing on any channel** — no
`text_delta`, no `thinking_delta`, no tool call — for the full 900s. `LessonPage` has no elapsed-time display
(`grep` for `setInterval|elapsed|Date.now` finds none), so the UI sits on a static "Socrates is thinking…" for
fifteen minutes. That is the least alive state possible, arriving exactly when liveness matters most. This is
why Phase 2 exists as its own phase rather than a footnote to the failure copy.

Normal turns are already live: `server.ts` streams `message_update` deltas and `LessonPage` re-renders per
delta through `reduceTurn`, and `turn.ts:30` already handles `thinking_delta`, so the Socratic Reasoning
drawer fills as the tutor works. **The liveness gap is specific to silence, not to normal operation** — worth
stating so the fix does not rebuild a pipeline that already works.

## References

- `.agent/grill/tutor-failure-and-capture.md` — the grill session for this work: the traced mechanism, the
  ranked risks, and the three open questions
- Owner's bug reports: `~/.socrates/reports/2026-09-14T18-34-38-160Z-e83cd798.json` (unit 2, stuck thinking),
  `…18-35-14-230Z-8e970457.json` (capture incorrect), `…18-36-53-297Z-5ad4e278.json` (unit 1, socratic broken)
- Session evidence: `~/.socrates/pi/sessions/--C--Users-Kasim Alam-.socrates-courses-automotive-alignments--/2026-09-14T18-26-44-399Z_*.jsonl`
- `DECISIONS.md` — the sandbox/isolation decision that governs generated content
- `LESSONS.md` — GL-024 (silent success) is the family both defects belong to

## Current step
**COMPLETE** (commit `8d0f474`). Both defects fixed, verified in a real browser, and the owner's three reports
resolved. Remaining items moved to `TASKS.md` as follow-ups.

## Notes

- Both defects were found by reading the owner's REAL data (report JSONs, screenshots, the pi session file),
  not by a test. Each fix therefore ships with a test that would have caught it.
- The measured numbers are the argument: `scrollTop 0 → error 0px`; `scrollTop 48 → error 48px`; four empty
  assistant records at gaps of 905/907/911s. No inference is required for either diagnosis.
- `capture.ts` already uses `getBoundingClientRect`, which is why the defect is the ADDED offset rather than
  a missing measurement — worth stating so the fix does not go looking in the wrong place.
