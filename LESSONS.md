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
- **`SCHEMA.md` has two writers** — authored prose (scaffold skill, human edits) and the telemetry
  projection. The projection may touch only the regions it owns and must never delete a
  misconception registry row: rows it does not know about predate the log and are authored content.
  Consequence: pre-existing duplicate ids do not self-heal — they surface as a
  `duplicate-registry-row:<id>` warning, and dedupe is a manual procedure documented in
  `docs/EVENT-SCHEMA.md`. The event schema, field semantics, and raw per-kind examples live there too.
