import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMission,
  parsePlan,
  parseSchema,
  parseLearning,
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
});

test("parseLearning reads a real directory", () => {
  const d = parseLearning("C:/Users/Kasim Alam/.pi/agent/learning-demo");
  assert.ok(d.present.includes("SCHEMA.md"));
  assert.equal(d.schema.concepts.length, 4);
  assert.equal(d.mission.destination, "read the React source and trace a render cycle without help");
});
