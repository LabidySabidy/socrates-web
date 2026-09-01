# Plan — Socrates-Web (standalone zero-dependency learning platform)

## Goal
A browser-based split-pane Socratic learning platform that reads `.agent/learning/` markdown and drives a background `pi --mode rpc` agent — with zero third-party dependencies, isolated from pi-web.

## Approach
Build in `F:\Development\socrates-web` using only Node built-ins (`node:http`, `node:fs`, `node:child_process`). A single Node process serves both the JSON API and the static dashboard, parses `MISSION.md`/`PLAN.md`/`SCHEMA.md` locally, and bridges browser chat to a persistent `pi --mode rpc` subprocess. TypeScript runs via Node 24 native type-stripping (no build step, no deps).

## Phases
1. **Standalone server + parser** — `learning-parser.ts` + `GET /api/learning` structured JSON.
2. **Background process bridge + streaming RPC** — spawn `pi --mode rpc`, `POST /api/chat`, `GET /api/stream` (SSE).
3. **Tufte-style dashboard front-end** — split-pane, four modules (Mission Anchor, Cognitive Index, Spaced Repetition Timeline, Misconception Board), click-to-grill.
4. **Socratic chat + hot-reloading watcher** — left chat column, `node:fs` watcher → SSE badge updates without reload.
5. **Guardrails** — Lobdell sprint gate, passivity intercept, Budapest mode toggle.

## Files that will change
| File | Change | Phase |
|---|---|---|
| `package.json` | scaffold (type: module, zero deps) | 1 |
| `learning-parser.ts` | markdown parser → structured JSON | 1 |
| `server.ts` | HTTP server, `GET /api/learning` | 1 |
| `learning-parser.test.ts` | node:test unit coverage | 1 |
| `bridge.ts` | child-process orchestrator | 2 |
| `public/index.html` | Tufte dashboard UI | 3-5 |

## Acceptance criteria
- [ ] `GET /api/learning` returns clean structured JSON (mission/plan/schema).
- [ ] `POST /api/chat` spawns `pi --mode rpc` and `GET /api/stream` streams markdown.
- [ ] Four dashboard panels render with correct typography; concept-card click injects `/skill:grill-misconception [concept]`.
- [ ] SCHEMA.md change hot-updates badges without reload.
- [ ] Sprint gate, passivity intercept, and Budapest toggle all fire in a simulated session.

## Not in scope
- Authentication, multi-user, any third-party npm dependency.
- Writing/mutating the learning markdown (read-only dashboard; writes stay in the Socratic skills/extensions).

## Open questions
- Default target project dir: `cwd` vs `PROJECT_DIR` env (leaning: `PROJECT_DIR`, fallback `cwd`).
- Port: defaulting `3850` (configurable via `PORT`).
- git init + remote for socrates-web (deferred until after Phase 1 approval).
