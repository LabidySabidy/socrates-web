import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMission,
  parsePlan,
  parseSchema,
  parseLearning,
  severityState,
  isSeverity,
} from "./learning-parser.ts";

test("parseMission extracts destination / artifact / driving project", () => {
  const m = parseMission(`
## Destination
- **I will be able to:** trace a render cycle
- **Proof-of-skill artifact:** a PR adding a custom hook
- **Driving project / pain:** slow dashboard
`);
  assert.equal(m.destination, "trace a render cycle");
  assert.equal(m.artifact, "a PR adding a custom hook");
  assert.equal(m.drivingProject, "slow dashboard");
});

test("parsePlan extracts sequence table + cut list", () => {
  const p = parsePlan(`
## 20-Hour Deconstruction
| # | Sub-skill | Why it matters | Hours |
|---|-----------|----------------|-------|
| 1 | Reconciliation | core | 6 |
| 2 | Fiber | scheduling | 5 |

## Cut List
- **Cut:** server components — out of scope
- **Defer (maybe later):** suspense — later
`);
  assert.equal(p.sequence.length, 2);
  assert.equal(p.sequence[0].skill, "Reconciliation");
  assert.equal(p.sequence[0].hours, "6");
  assert.equal(p.sequence[1].n, 2);
  assert.equal(p.cutList.length, 2);
  assert.match(p.cutList[0], /server components/);
});

test("parseSchema extracts concepts, badges, sm2, due, misconceptions", () => {
  const s = parseSchema(`
### 🟩 component-lifecycle
- **SM-2 telemetry:**
  - \`next_review\`: 2020-01-01
  - \`interval\`: 10
  - \`ease_factor\`: 2.5
  - \`repetitions\`: 2

### ⬜ hooks
- **SM-2 telemetry:**
  - \`next_review\`: —
  - \`interval\`: 0

## 3. Misconception Registry
| MIS-001 | react-state | thought X | correct | resolved | 2026-01-01 |
| MIS-002 | lifecycle | believed Y |  | open | 2026-02-01 |
`);
  assert.equal(s.concepts.length, 2);
  assert.equal(s.concepts[0].name, "component-lifecycle");
  assert.equal(s.concepts[0].badge, "🟩");
  assert.equal(s.concepts[0].label, "Good");
  assert.equal(s.concepts[0].sm2.interval, 10);
  assert.equal(s.concepts[0].sm2.ease_factor, 2.5);
  assert.equal(s.concepts[0].due, "due"); // 2020-01-01 is in the past
  assert.equal(s.concepts[1].name, "hooks");
  assert.equal(s.concepts[1].badge, "⬜");
  assert.equal(s.concepts[1].due, "unscheduled"); // next_review "—"
  assert.equal(s.misconceptions.length, 2);
  assert.equal(s.misconceptions[0].status, "resolved");
  assert.equal(s.misconceptions[1].status, "open");
  // 6-column rows (no severity column) must still parse as unrated.
  assert.equal(s.misconceptions[0].severity, "");
  assert.equal(s.misconceptions[0].severityState, "resolved");
  assert.equal(s.misconceptions[1].severityState, "unrated");
});

test("parseSchema reads severity from the 7th column", () => {
  const s = parseSchema(`
## 3. Misconception Registry
| MIS-001 | react-state | thought X | | open | 2026-01-01 | root |
| MIS-002 | lifecycle | believed Y | | open | 2026-02-01 | edge |
| MIS-003 | hooks | believed Z | | resolved | 2026-03-01 | partial |
| MIS-004 | fiber | believed W | | open | 2026-04-01 | |
| MIS-005 | effects | believed V | | open | 2026-05-01 | not-a-severity |
`);
  assert.deepEqual(
    s.misconceptions.map((m) => m.severity),
    ["root", "edge", "partial", "", ""],
  );
  assert.deepEqual(
    s.misconceptions.map((m) => m.severityState),
    ["root", "edge", "resolved", "unrated", "unrated"],
  );
});

test("severityState: resolution outranks a stale rating; blanks are unrated", () => {
  assert.equal(severityState("resolved", "root"), "resolved");
  assert.equal(severityState("open", ""), "unrated");
  assert.equal(severityState("open", undefined), "unrated");
  assert.equal(isSeverity("partial"), true);
  assert.equal(isSeverity("unrated"), false, "unrated is derived, not storable");
  assert.equal(isSeverity("resolved"), false, "resolved is a status, not a severity");
});

test("parsePlan preserves an empty 'why' column without shifting", () => {
  const p = parsePlan(`
## 20-Hour Deconstruction
| # | Sub-skill | Why it matters | Hours |
|---|-----------|----------------|-------|
| 2 | Fiber | | 5 |
`);
  assert.equal(p.sequence.length, 1);
  assert.equal(p.sequence[0].skill, "Fiber");
  assert.equal(p.sequence[0].why, "");
  assert.equal(p.sequence[0].hours, "5");
});

test("parseSchema preserves an empty 'corrected' column without shifting", () => {
  const s = parseSchema(`
## 3. Misconception Registry
| MIS-002 | lifecycle | believed Y | | open | 2026-02-01 |
`);
  assert.equal(s.misconceptions.length, 1);
  assert.equal(s.misconceptions[0].id, "MIS-002");
  assert.equal(s.misconceptions[0].concept, "lifecycle");
  assert.equal(s.misconceptions[0].misconception, "believed Y");
  assert.equal(s.misconceptions[0].corrected, "");
  assert.equal(s.misconceptions[0].status, "open");
  assert.equal(s.misconceptions[0].date, "2026-02-01");
});

test("parseLearning reads a real directory", () => {
  const d = parseLearning("C:/Users/Kasim Alam/.pi/agent/learning-demo");
  assert.ok(d.present.includes("SCHEMA.md"));
  assert.equal(d.schema.concepts.length, 4);
  assert.equal(d.mission.destination, "read the React source and trace a render cycle without help");
});
