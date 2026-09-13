# Decisions

> ADR-lite: why we did what we did, so future-me doesn't re-litigate.

## 2026-09-12 — Bundle pi as an npm dependency (abandon zero-dependency)

**Context:** Socrates-Web drives a `pi --mode rpc` subprocess for the Socratic chat bridge. Originally `pi` was resolved from PATH, so a fresh machine without pi installed would silently lose the chat bridge. Goal: "anyone can download and get going."

**Decision:** Add `@earendil-works/pi-coding-agent` as a runtime dependency. `process-bridge.ts` resolves the bundled CLI via `import.meta.resolve` (`require.resolve` fails — the package is ESM-only with no `require` export condition) and spawns it as `node <cli> --mode rpc`. `PI_BIN`/`PI_ARGS` env remain as escape hatches (used by tests to inject a mock pi).

**Alternatives considered:**
- Document pi as a manual prerequisite + startup check — simplest, but not turnkey.
- Vendor a setup script that installs pi locally — turnkey-ish, but an extra step beyond plain `npm install`.

**Tradeoffs:** Sacrifices the zero-dependency principle (~165 packages pulled in). Accepted because turnkey distribution outweighs the aesthetic constraint; Node built-ins still handle all HTTP/parsing/watching.
