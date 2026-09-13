# Handoff Analysis — Socrates Platform + Cockpit

> Review artifact. Three parts: what to take from the handoff, what the real backend
> is missing, and the spike evidence for the two riskiest unknowns.
> Visual targets: `docs/handoff-shots/` (home, course, lesson, quiz, lab, cockpit).
>
> **Historical (2026-09-13).** This analysis and its spikes are the record of what was true when the
> platform was being designed. Its discovery conclusions — `PROJECT_DIR`, `COURSES_ROOT`, the scan,
> the registry overlay, the folder browser — were **superseded by P16, "a course is a subject, not a
> folder"** (`DECISIONS.md`). Spike B's finding that `parseLearning(dir)` is directory-agnostic still
> holds and is why a course can live in the store; the enumeration machinery built on it is gone.
> Read `docs/CONTENT-MODEL.md` and `DECISIONS.md` for the current model.

---

## 1. Separation note — patterns to adopt vs sample content to discard

### ADOPT (the patterns — this is the value)

**Information architecture**
- Home catalog → Course page → Lesson / Assessment / Lab. Hash-routed, shared URLs, back/forward.
- Course page = two independently scrolling panes: fixed 290px unit rail + 780px module pane.
- Unit rail: course switcher (`<select>`), per-unit mastery ring, 3px active-unit `action` left
  bar + `action-tint` fill, `aria-current`, and a transparent left border on inactive rows so
  nothing shifts on selection.
- Module pane: "Unit N: <title>" + aggregate mastery ring, "About this unit" blurb, lesson
  groups on hairlines, module rows = type icon + title + uppercase type label + mastery pip.
- Module taxonomy with icon + label: Article, Video, Practice, Quiz, Unit test, Course
  challenge, Primary source, FAQ, Game, Interact, AI activity.
- Routing rule: lab → Lab, FAQ → FAQ, Primary source → source, Quiz/Unit test/Course challenge
  → Quiz, everything else → Lesson.

**Chat-first lesson**
- EXPLAIN → SHOW → ASK rhythm: unboxed tutor prose → inline generated visual → embedded check.
- **Socratic Reasoning drawer**: `<details>` that holds anything the tutor emitted as
  `Thinking:` / `<thinking>` — stripped from the visible message, not deleted.
- Composer pinned below the scroll area; auto-grow; Enter sends, Shift+Enter newline.
- "Socrates is thinking…" presence state before the first token; incremental append after.
- Exit Lesson returns to the originating course + unit with progress intact (never a reset).

**Assessment behavior (Screen D)**
- One problem at a time; sticky footer with "N of M" + progress dots.
- Primary action label cycle: Check → Try again → Next → Finish.
- Hints revealed one at a time with a 1/3 → 2/3 → 3/3 counter; Skip withdrawn once wrong.
- Toast feedback: `success` "There you go!" / `warning` "Not quite! Give it another try!".
- **Two-mistake mastery gate** modal: "You can no longer reach Proficient on this attempt."
  Start over = full reset; Keep going = dismiss.
- Completion = calm level-up panel (no confetti under reduced motion).

**Tutor telemetry (Cockpit) — as a *surfacing of data this repo already has***
- SM-2 panel (interval / ease / repetitions) ← `SCHEMA.md` SM-2 fields.
- Misconception tray with "N uncorrected" and Dismantle ← misconception registry table.
- Syllabus progress index with due/overdue/learning/unseen labels ← `next_review` vs today.
- Rest gate + passivity intercept already exist in this repo (`public/app.js`).

**Design language**
- Tokens: `paper #fffff8`, `paper-sunk #fcfcf3`, `surface #fff`, `ink #201f1d` + 70/55/45
  alphas, `rule` 12% / `rule-soft` 7%, `action #1865f2` + 6% tint, `warning #d97706/#b45309`,
  `success #2d7a4c`.
- 5-state mastery union **and nothing else**: Not started `#c9c6bd` (0) · Attempted `#d97706`
  (0.25) · Familiar `#4a6fa5` (0.50) · Proficient `#2d7a4c` (0.78) · Mastered `#14462c` (1.00).
- Type: Cormorant Garamond display (lighter as it gets larger), Lora for reading content,
  system sans for chrome, 10–10.5px uppercase eyebrows at `.14em`, tabular figures for numbers.
- Color is stroke, never fill. Buttons outlined. Hairline 1px everywhere. Whisper shadows only.
- Motion 0.18–0.3s, all of it gated by `prefers-reduced-motion: reduce`.
- A11y: `aria-current` on active unit/module, `aria-pressed` on chips/toggles, `aria-label` on
  every ring/pip/graph/canvas, `role="img"` on data SVGs, `role="dialog" aria-modal` on modals,
  `role="status"` on toasts, visible 2px `action` focus ring, ~36px minimum target.

### DISCARD (sample content — must not reach production code paths)

- Every course, unit, lesson, module title, blurb, and word of lesson prose (Algebra 1,
  JavaScript and the web, NASA, slope, Descartes, Mars).
- The quiz bank: questions, answers, hint steps, and per-item graph annotations.
- All fabricated progress: 40% rings, "6 wk" streak, "Lv 7", "41,850 ep", 14/23/31 counts, and
  the Meteorite → Moon → Earth → Sun → Black Hole badge discs.
- The Cockpit's "82% durable retention" and "3 overdue reviews" — see gap analysis: retention
  has no backing field.
- The sample Mars globe and Cruise to Mars game *content* (the interaction pattern is keepable).
- The "Generate interactive" modal's slope-slider sample payload.
- `support.js` and all inline styles (README explicitly forbids porting either).

### Deferred / no content source yet
- **FAQ** and **Primary source** screens: both render authored prose. Nothing on disk authors
  either. The Descartes plate is a CSS placeholder that needs a real facsimile image.

---

## 2. Gap analysis — handoff pattern → current capability → missing

| Handoff pattern | Current capability | Missing |
|---|---|---|
| Courses → Units → Lessons → Modules | `MISSION.md`/`PLAN.md`/`SCHEMA.md` → flat `LearningData`; one dir | The tree itself: model, parser, API |
| Add / register a course | Single required `PROJECT_DIR` env | Registry, validation, multi-course serve, UI flow |
| Course switcher | — | Course list in the client + per-course route |
| 5-state mastery | 5 emoji badges (`⬜🟥🟨🟩🟦`) + SM-2 fields | badge → state/color/ring mapping (1:1, **no new data needed**) |
| Unit aggregate ring, course % | — | Derivation rule (nothing stores a percentage) |
| Mastery pips on module rows | Concept badge | Same mapping |
| Due / overdue / unseen labels | `due: due \| upcoming \| unscheduled` in parser | "overdue" is distinguishable; "learning"/"unseen" labels are cosmetic |
| Quiz / Unit test / Course challenge | — | **Item bank source — nothing exists on disk** (see spike finding 3) |
| Hints (1/3 → 3/3), 2-mistake gate, attempts, completion | — | Attempt/session state; no client or server store today |
| Interactive / Game modules | — | Generation path through pi + sandboxing + validation |
| Interactive generation ("author control") | `POST /api/chat` reaches the real pi bridge | Prompt/contract for "generate an interactive for concept X", and a place to store it |
| Chat-first lesson wired to real pi | `POST /api/chat` + `GET /api/stream` **already real** | Lesson shell; splitting `thinking_delta` into the Reasoning drawer; per-lesson thread |
| Streaming tutor prose | `thinking_delta` + `text_delta` SSE events | Nothing — replace the mockup's timer stream |
| Socratic Reasoning drawer | `thinking_delta` handler in `app.js` already prints thinking | Route it into a `<details>`, strip from the visible message |
| Routing / screens | Single page, no router | Hash router + ~7 views |
| Cockpit telemetry | SM-2 fields, misconception table, rest gate, passivity banner **all exist** | Surfacing UI; a side-by-side "cockpit" layout |
| Retention score (82%) | **None** | Either a derivation rule or drop it from v1 |
| Streak / level / energy / badges | None | Drop, or derive later — decorative, never framed as mastery |
| SCHEMA.md hot-reload | 150ms debounced watcher → `{type:"reload"}` SSE **exists** | Extend to N watched courses |

---

## 3. Spike results

### Spike A — "PLAN.md's roadmap phases can be derived into units" → **DISPROVED**

Read the roadmap with a regex, matched phase prose against concept names.

```
phaseCount: 3    conceptCount: 5
unit 1 "Migration & state machine"  → [moderation-state-machine]
unit 2 "RLS"                        → []  ← nothing matched
unit 3 "RPC + client flow"          → [client-data-flow]
orphanConcepts: idempotent-migrations, rls-policies, security-definer-rpc
```

**Why it failed:** there is no machine-readable link between a PLAN phase and a SCHEMA concept.
Prose matching is guessing, which is exactly the "don't invent a data shape" trap. Worse, the
second real project on this machine (`~/.pi/agent/learning-demo`) has **no Sequenced Roadmap at
all**, so this derivation returns zero units there.

### Spike A2 — "Unit = concept card, 1:1" → **PROVED**

```
units: idempotent-migrations, rls-policies, security-definer-rpc, client-data-flow,
       moderation-state-machine
everyUnitHasMastery: true
```

The concept card is the only structure that is universally present, uniquely named, and already
carries mastery + SM-2 + misconceptions. Units derived this way need **zero invented data** in
both real projects.

### Spike B — "N courses can be served without breaking the single-PROJECT_DIR assumptions" → **PROVED**

`parseLearning(dir)` is already directory-agnostic. Both models work against the real dirs:

```
scanModel:     [F:\Development\DriftScout (5 concepts), …\learning-demo (4 concepts)]
registryModel: [F:\Development\DriftScout (5 concepts), …\learning-demo (4 concepts)]
```

**Constraint surfaced:** the bridge spawns `pi` with `cwd = PROJECT_DIR`. Which directory pi runs
in *is* which course the tutor can read and write. Multi-course therefore forces an explicit
decision: one bridge per course, or one bridge restarted (or `cwd` switched) on course switch.

### Spike finding 3 — no assessment or interactive content exists on disk

```
find .agent -type f →
  MISSION.md PLAN.md SCHEMA.md telemetry.jsonl telemetry-state.json   (both projects)
```

No quiz items, no hint steps, no interactive definitions. Screens D and E cannot be *read* from
the content model; they must be *generated* (pi) or *authored* in a format this project defines.

---

## 4. Decisions needed before PLAN.md

1. **Content model.** Unit = concept card (derived default, proven) — or add an authored
   `COURSE.md` manifest that can override the derived tree when a course wants real lesson groups?
2. **Add-a-course flow.** Hand-edited registry file vs. scan a root for `*/.agent/learning` vs.
   a UI form posting to `POST /api/courses`. (Spike proves the backend side of all three.)
3. **Multi-course bridge.** One `pi` process per course, or one process restarted on switch?
   This decides whether a course switch can be instant or costs a spawn.
4. **Retention score.** Derive it (from repetitions/ease/interval — a proxy, not "durable
   retention") or drop it from v1 and keep the SM-2 panel + misconception tray?
5. **Frontend.** Keep the no-build vanilla frontend, or adopt Vite + React? The handoff is five
   screens plus a quiz state machine plus two canvas interactives — that is the largest single
   risk in this plan.
6. **Assessments.** Where do quiz items come from: generated by pi on demand, or authored files?
   (Composes with #1 — the answer changes the content model.)
7. **`/api/learning` shape.** Keep it as the single-course endpoint and add per-course routes, or
   version it to `/api/v1/...`?
