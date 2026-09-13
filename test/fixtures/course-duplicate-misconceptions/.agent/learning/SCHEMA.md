# SCHEMA — Duplicate Misconceptions

## 2. Schema Taxonomy

### 🟨 react-state

- **Status:** 🟨 Fair
- **SM-2 telemetry:**
  - `last_tested`: 2026-09-01
  - `next_review`: 2026-09-20
  - `interval`: 2
  - `ease_factor`: 2.5
  - `repetitions`: 1
- **Misconceptions:** MIS-003, MIS-004

### 🟩 hooks

- **Status:** 🟩 Good
- **SM-2 telemetry:**
  - `last_tested`: 2026-09-01
  - `next_review`: 2026-09-25
  - `interval`: 6
  - `ease_factor`: 2.6
  - `repetitions`: 2
- **Misconceptions:** MIS-005

## 3. Misconception Registry

| ID | Concept | Misconception (what I believed) | Corrected model (my own words) | Status | Date | Severity |
|----|---------|---------------------------------|-------------------------------|--------|------|----------|
| MIS-003 | react-state | Believed setState mutates state synchronously, so a second call in the same handler reads the updated value | | open | 2026-09-01 | root |
| MIS-003 | react-state | Believed setState mutates the state variable synchronously | | open | 2026-09-01 | |
| MIS-003 | react-state | Believes setState is synchronous and batched | | open | 2026-09-01 | |
| MIS-004 | react-state | Believed an empty dependency array runs the effect on every render | [] runs once on mount | resolved | 2026-09-01 | root |
| MIS-005 | hooks | Believed hooks could be called conditionally | hooks are order-dependent | open | 2026-09-02 | partial |
| MIS-006 | hooks | Minor slip on the rules-of-hooks lint rule | | open | 2026-09-02 | |

## 4. SM-2 Spaced Telemetry

| Concept | last_tested | next_review | interval (days) | ease_factor | repetitions |
|---------|-------------|-------------|-----------------|-------------|-------------|
| react-state | 2026-09-01 | 2026-09-20 | 2 | 2.5 | 1 |
| hooks | 2026-09-01 | 2026-09-25 | 6 | 2.6 | 2 |
