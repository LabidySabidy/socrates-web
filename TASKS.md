# Socrates-Web — Master Task Tracker

> Standalone zero-dependency browser learning platform in `F:\Development\socrates-web`.
> Status: `[ ]` todo · `[x]` done. Stop after each phase for user approval.

## Phase 1 — Standalone Server & Zero-Dependency Markdown Parser
- [x] `learning-parser.ts` parses MISSION/PLAN/SCHEMA with zero deps
- [x] `server.ts` serves `GET /api/learning`
- **Done when:** `node server.ts` + `curl /api/learning` returns clean structured JSON mapping mission/plan/schema.

## Phase 2 — Background Process Bridge & Streaming RPC
- [ ] `bridge.ts` spawns persistent `pi --mode rpc` (node:child_process)
- [ ] `POST /api/chat` passes browser text to pi stdio
- [ ] `GET /api/stream` (SSE) streams pi's character-by-character markdown
- **Done when:** mock POST spins up the pi agent and streams its raw markdown dialogue.

## Phase 3 — Tufte-Style Dashboard Front-End
- [ ] split-pane layout (dashboard right column)
- [ ] MISSION ANCHOR module
- [ ] COGNITIVE INDEX grid — click card → `/skill:grill-misconception [concept]`
- [ ] SPACED REPETITION TIMELINE — due-today highlighted
- [ ] MISCONCEPTION BOARD — open red, resolved gray
- **Done when:** mock data renders all four panels with correct typography + click interactions.

## Phase 4 — Socratic Chat Interface & Hot-Reloading Watcher
- [ ] serif chat stream (left column)
- [ ] `node:fs` watcher on `.agent/learning/`
- [ ] SSE push on SCHEMA.md change → badges update without reload
- **Done when:** type in chat → pi streams → dashboard badge elevates on schema change.

## Phase 5 — Timer Rest Gates, Passivity Intercepts, Budapest Mode
- [ ] SPRINT_GATE signal → freeze chat input + 5-min countdown modal
- [ ] PASSIVITY INTERCEPT → warning banner
- [ ] BUDAPEST MODE toggle → prepend no-lecture prompt to outbound inputs
- **Done when:** simulated session proves all three guardrails fire.
