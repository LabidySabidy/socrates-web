/**
 * course-model.ts — derives the Course → Units → Lessons → Modules tree.
 *
 * Two tiers, precedence `COURSE.md` manifest > derived:
 *
 *   DERIVED (default, zero new files): one unit per SCHEMA.md concept card. Spike evidence
 *   showed PLAN roadmap phases cannot be joined to concepts — prose matching recovered 2 of 5
 *   concepts in one real project and 0 of 4 in another — so phases are course *context*, never
 *   units. The concept card is the only structure that is universally present, uniquely named,
 *   and already carries mastery.
 *
 *   MANIFEST (optional): COURSE.md declares units, groups, module types, ordering, and
 *   assessment placement, and may override `kind` and `title`.
 *
 * Degenerate inputs never throw. Every one of them produces a renderable tree plus a warning,
 * because a broken rail is worse than an honest empty state.
 *
 * Rules and the warnings table: docs/CONTENT-MODEL.md
 */
import type { Badge, LearningData } from "./learning-parser.ts";
import { SEVERITIES, severityState, type SeverityState } from "./learning-parser.ts";
import { courseOracle, validateItems, type AssessmentItem, type CiteOracle, type Quiz } from "./assessments.ts";
import { validateSpecs, type Interactive, type Spec } from "./interactives.ts";

// ---------------------------------------------------------------------------
// Mastery — the five-state union. Six states is never correct.
// ---------------------------------------------------------------------------

export const MASTERY_STATES = [
  "Not started",
  "Attempted",
  "Familiar",
  "Proficient",
  "Mastered",
] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export interface Mastery {
  state: MasteryState;
  /** Colour is applied as a stroke (ring / pip), never a fill. */
  color: string;
  /** Ring fraction used by the design system. */
  ring: number;
}

export const MASTERY_BY_BADGE: Record<Badge, Mastery> = {
  "⬜": { state: "Not started", color: "#c9c6bd", ring: 0 },
  "🟥": { state: "Attempted", color: "#d97706", ring: 0.25 },
  "🟨": { state: "Familiar", color: "#4a6fa5", ring: 0.5 },
  "🟩": { state: "Proficient", color: "#2d7a4c", ring: 0.78 },
  "🟦": { state: "Mastered", color: "#14462c", ring: 1 },
};

/** Anything outside the five-state union reads as Not started rather than inventing a sixth. */
export const MASTERY_UNKNOWN: Mastery = MASTERY_BY_BADGE["⬜"];

export function masteryOf(badge: string | undefined): Mastery {
  if (!badge) return MASTERY_UNKNOWN;
  return MASTERY_BY_BADGE[badge as Badge] ?? MASTERY_UNKNOWN;
}

/** Mean ring → the nearest of the five states. Empty in, Not started out. */
export function aggregateMastery(masteries: Mastery[]): Mastery {
  if (masteries.length === 0) return MASTERY_UNKNOWN;
  const mean = masteries.reduce((sum, m) => sum + m.ring, 0) / masteries.length;
  let best = MASTERY_UNKNOWN;
  let bestDelta = Infinity;
  for (const state of MASTERY_STATES) {
    const candidate = Object.values(MASTERY_BY_BADGE).find((m) => m.state === state);
    if (!candidate) continue;
    const delta = Math.abs(candidate.ring - mean);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

export function countByMastery(masteries: Mastery[]): Record<MasteryState, number> {
  const counts = Object.fromEntries(MASTERY_STATES.map((s) => [s, 0])) as Record<MasteryState, number>;
  for (const m of masteries) counts[m.state] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Module taxonomy
// ---------------------------------------------------------------------------

/** Derived study actions, plus the types a manifest or generator may author. */
export const DERIVED_MODULE_TYPES = ["recite", "review", "explain", "misconceptions"] as const;
export const AUTHORED_MODULE_TYPES = [
  "article",
  "video",
  "practice",
  "quiz",
  "test",
  "course-challenge",
  "primary-source",
  "faq",
  "interact",
  "game",
  "project",
  "ai-activity",
] as const;
export const MODULE_TYPES = [...DERIVED_MODULE_TYPES, ...AUTHORED_MODULE_TYPES] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export function isModuleType(v: unknown): v is ModuleType {
  return typeof v === "string" && (MODULE_TYPES as readonly string[]).includes(v);
}

export interface Module {
  id: string;
  type: ModuleType;
  title: string;
  /** Present when the module is attached to a concept card. */
  concept?: string;
  /** `true` when a manifest referenced a concept that does not exist. */
  missing?: boolean;
  badge?: string;
  mastery?: Mastery;
  due?: "due" | "upcoming" | "unscheduled";
  severity?: SeverityState;
  count?: number;
  items?: number;
}

export interface LessonGroup {
  title: string;
  note?: string;
  modules: Module[];
}

export interface Unit {
  n: number;
  title: string;
  blurb?: string;
  mastery: Mastery;
  groups: LessonGroup[];
  /** Concept names this unit is built from (derived units have exactly one). */
  concepts: string[];
  /** Set by a manifest, never by the derivation — spikes showed phases cannot be joined. */
  authored?: boolean;
}

export interface CourseTree {
  id: string;
  dir: string;
  title: string;
  kind: "topic" | "codebase";
  derived: boolean;
  warnings: string[];
  mission: LearningData["mission"];
  plan: { sequence: LearningData["plan"]["sequence"]; cutList: string[] };
  units: Unit[];
  /** Authored quizzes, bound to a unit by manifest position. Validated on load. */
  quizzes: Quiz[];
  /** Authored interactives and games, likewise bound by position and validated on load. */
  interactives: Interactive[];
  mastery: { counts: Record<MasteryState, number>; aggregate: Mastery; total: number };
}

export interface CourseSource {
  /** Stable id — the course directory's basename. */
  id: string;
  dir: string;
  data: LearningData;
  /** Raw SCHEMA.md, needed to spot headings outside the five-state union. */
  schemaText: string | null;
  /** Raw COURSE.md, if the course authored one. */
  manifestText: string | null;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export const WARN = {
  noSchema: "no-schema",
  noMission: "no-mission",
  noConcepts: "no-concepts",
  duplicateConcept: (name: string) => `duplicate-concept:${name}`,
  unknownBadge: (title: string) => `unknown-badge:${title}`,
  manifestInvalid: (reason: string) => `manifest-invalid:${reason}`,
  unknownLesson: (name: string) => `unknown-lesson:${name}`,
  manifestDuplicate: (name: string) => `manifest-duplicate:${name}`,
} as const;

export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Headings of the shape `### <token> <name>` in the raw schema, token included verbatim. */
export function scanCardHeadings(schemaText: string): { token: string; name: string }[] {
  const out: { token: string; name: string }[] = [];
  for (const line of schemaText.split("\n")) {
    const m = /^###\s+(\S+)\s+(.+?)\s*$/.exec(line.trim());
    if (m) out.push({ token: m[1], name: m[2] });
  }
  return out;
}

const KNOWN_BADGES = new Set(Object.keys(MASTERY_BY_BADGE));

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Derived study actions for one concept card. */
function derivedModules(card: {
  name: string;
  badge: Badge;
  due: "due" | "upcoming" | "unscheduled";
  misconceptionIds: string[];
  severityStates: SeverityState[];
}): Module[] {
  const concepts = card.name;
  const mastery = masteryOf(card.badge);
  const base = { concept: concepts, badge: card.badge, mastery };
  const modules: Module[] = [
    { id: `${slug(concepts)}/recite`, type: "recite", title: `Recite ${concepts}`, ...base },
    { id: `${slug(concepts)}/review`, type: "review", title: `Review ${concepts}`, due: card.due, ...base },
    { id: `${slug(concepts)}/explain`, type: "explain", title: `Explain ${concepts} in your own words`, ...base },
  ];
  if (card.misconceptionIds.length > 0) {
    modules.push({
      id: `${slug(concepts)}/misconceptions`,
      type: "misconceptions",
      title: `Misconceptions (${card.misconceptionIds.length})`,
      count: card.misconceptionIds.length,
      severity: card.severityStates[0],
      ...base,
    });
  }
  return modules;
}

export function deriveUnits(src: CourseSource, warnings: string[]): Unit[] {
  const { concepts, misconceptions } = src.data.schema;

  // duplicate concept names: state would split across two cards and the writer can only
  // ever reach the first one, so surface it instead of silently picking one.
  const seen = new Map<string, number>();
  for (const c of concepts) seen.set(slug(c.name), (seen.get(slug(c.name)) ?? 0) + 1);
  for (const [key, n] of seen) if (n > 1) warnings.push(WARN.duplicateConcept(key));

  // headings whose token is not one of the five badges are invisible to the parser
  if (src.schemaText) {
    for (const h of scanCardHeadings(src.schemaText)) {
      if (!KNOWN_BADGES.has(h.token)) warnings.push(WARN.unknownBadge(h.name));
    }
  }

  const unique: typeof concepts = [];
  const emitted = new Set<string>();
  for (const c of concepts) {
    const key = slug(c.name);
    if (emitted.has(key)) continue; // first card wins; warning already raised
    emitted.add(key);
    unique.push(c);
  }

  return unique.map((c, i) => {
    const mine = misconceptions.filter((m) => slug(m.concept) === slug(c.name));
    return {
      n: i + 1,
      title: c.name,
      mastery: masteryOf(c.badge),
      concepts: [c.name],
      groups: [
        {
          title: c.name,
          modules: derivedModules({
            name: c.name,
            badge: c.badge,
            due: c.due,
            misconceptionIds: [...new Set(mine.map((m) => m.id))],
            severityStates: mine.map((m) => m.severityState),
          }),
        },
      ],
    };
  });
}

export function buildCourse(src: CourseSource, opts: { oracle?: CiteOracle } = {}): CourseTree {
  const warnings: string[] = [];
  const present = src.data.present;
  const oracle = opts.oracle ?? courseOracle(src.dir);

  if (!present.includes("SCHEMA.md")) warnings.push(WARN.noSchema);
  if (!present.includes("MISSION.md")) warnings.push(WARN.noMission);

  const mission = src.data.mission;
  const title =
    mission.destination.trim() || src.manifestText?.match(/^title:\s*(.+)$/m)?.[1]?.trim() || src.id;

  let units = deriveUnits(src, warnings);
  let quizzes: Quiz[] = [];
  let interactives: Interactive[] = [];
  let derived = true;
  let kind: CourseTree["kind"] = "topic";
  let courseTitle = title;

  if (src.manifestText) {
    const parsed = parseCourseManifest(src.manifestText, src);
    if ("error" in parsed) {
      warnings.push(WARN.manifestInvalid(parsed.error));
    } else {
      units = parsed.units;
      quizzes = parsed.quizzes;
      interactives = parsed.interactives.map((lab) => ({
        id: lab.id,
        title: lab.title,
        unit: lab.unit,
        source: "authored" as const,
        spec: lab.spec,
      }));
      derived = false;
      kind = parsed.kind;
      if (parsed.title) courseTitle = parsed.title;
      warnings.push(...parsed.warnings);
    }
  }

  // An authored item must satisfy the same gate a generated one does, or it is not served.
  if (quizzes.length > 0) {
    const checked: Quiz[] = [];
    for (const quiz of quizzes) {
      const { items, errors } = validateItems(quiz.items, {
        kind,
        oracle,
        prefix: `${quiz.id}-q`,
      });
      for (const error of errors) warnings.push(`assessment-invalid:${quiz.id}:${error}`);
      if (items.length > 0) checked.push({ ...quiz, items });
      else if (errors.length > 0) warnings.push(`assessment-dropped:${quiz.id}`);
    }
    quizzes = checked;
  }

  // An authored interactive must satisfy the same gate a generated one does, or it is not served.
  if (interactives.length > 0) {
    const kept: Interactive[] = [];
    for (const interactive of interactives) {
      const { specs, errors } = validateSpecs([interactive.spec], {
        kind,
        oracle,
        prefix: `${interactive.id}-i`,
      });
      for (const error of errors) warnings.push(`interactive-invalid:${interactive.id}:${error}`);
      if (specs.length > 0) kept.push({ ...interactive, spec: specs[0] });
      else if (errors.length > 0) warnings.push(`interactive-dropped:${interactive.id}`);
    }
    interactives = kept;
  }

  if (units.length === 0 && !warnings.includes(WARN.noConcepts)) warnings.push(WARN.noConcepts);

  const conceptMasteries = src.data.schema.concepts.map((c) => masteryOf(c.badge));
  return {
    id: src.id,
    dir: src.dir,
    title: courseTitle,
    kind,
    derived,
    warnings: [...new Set(warnings)],
    mission,
    plan: { sequence: src.data.plan.sequence, cutList: src.data.plan.cutList },
    units,
    quizzes,
    interactives,
    mastery: {
      counts: countByMastery(conceptMasteries),
      aggregate: aggregateMastery(conceptMasteries),
      total: conceptMasteries.length,
    },
  };
}

// ---------------------------------------------------------------------------
// COURSE.md manifest — authored override
// ---------------------------------------------------------------------------

export interface ManifestResult {
  units: Unit[];
  quizzes: Quiz[];
  interactives: { id: string; title: string; unit: number; spec: Spec }[];
  kind: CourseTree["kind"];
  title?: string;
  warnings: string[];
}

const UNIT_RE = /^##\s+Unit\s+(\d+)\s*:\s*(.+?)\s*$/;
const GROUP_RE = /^###\s+Group\s*:\s*(.+?)\s*$/;
const QUIZ_SECTION_RE = /^##\s+Quiz\s*:\s*(.+?)\s*$/;
const LAB_SECTION_RE = /^##\s+(Interactive|Game)\s*:\s*(.+?)\s*$/;
const LAB_FIELD_RE = /^\s*-\s+\*\*(kind|fn|caption|param|speed|band|cites|xrange):\*\*\s*(.*)$/i;
const QUESTION_RE = /^-\s+\*\*Q\*\*\s+(.*)$/;
const ITEM_FIELD_RE = /^\s*-\s+\*\*(answer|accepts|hint|step|cite):\*\*\s*(.*)$/i;
const MODULE_RE = /^-\s+\*\*Module\*\*\s+\(`([a-z][a-z-]*)`\)\s+(.*)$/;
const QUIZ_RE = /^-\s+\*\*Quiz\*\*\s+(\d+)\s+items?\s*$/;
const REF_RE = /@([a-z0-9][a-z0-9-]*)/i;

/**
 * Parse a COURSE.md manifest. The grammar is deliberately tiny and line-oriented so that an
 * invalid manifest fails loudly into `manifest-invalid:<reason>` and the derivation is used
 * instead — a malformed manifest must never produce a half-built tree.
 *
 *   ```yaml            <- optional meta: `kind:` and `title:`
 *   ## Unit 1: Title    <- unit
 *   > blurb            <- optional unit blurb
 *   ### Group: Name     <- lesson group
 *   - **Module** (`article`) Title @concept-name
 *   - **Quiz** 3 items
 */
export function parseCourseManifest(
  text: string,
  src: CourseSource,
): ManifestResult | { error: string } {
  const kindMatch = /^kind:\s*(topic|codebase)\s*$/m.exec(text);
  const titleMatch = /^title:\s*(.+?)\s*$/m.exec(text);

  const units: Unit[] = [];
  const warnings: string[] = [];
  const conceptByName = new Map(src.data.schema.concepts.map((c) => [slug(c.name), c]));
  const seenUnitTitles = new Set<string>();

  let unit: Unit | null = null;
  let group: LessonGroup | null = null;

  // Authored quiz items are collected as raw text here and validated by buildCourse, so an
  // invalid authored item fails the same gate a generated one does.
  type RawItem = { prompt: string; answer?: string; accepts: string[]; hints: string[]; steps: string[]; cites: string[] };
  let quiz: { title: string; unit: number; items: RawItem[] } | null = null;
  const sections: { title: string; unit: number; items: RawItem[] }[] = [];
  let item: RawItem | null = null;

  // Interactives are collected raw and validated by buildCourse, like quiz items.
  let lab: { title: string; unit: number; raw: Record<string, unknown> } | null = null;
  const labSections: { title: string; unit: number; raw: Record<string, unknown> }[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("> ")) {
      if (unit && !unit.blurb) unit.blurb = line.slice(2).trim();
      continue;
    }

    const unitMatch = UNIT_RE.exec(line);
    if (unitMatch) {
      const title = unitMatch[2];
      const key = slug(title);
      if (seenUnitTitles.has(key)) warnings.push(WARN.manifestDuplicate(title));
      seenUnitTitles.add(key);
      unit = {
        n: Number(unitMatch[1]),
        title,
        mastery: MASTERY_UNKNOWN,
        groups: [],
        concepts: [],
        authored: true,
      };
      units.push(unit);
      group = null;
      quiz = null;
      item = null;
      continue;
    }

    // A quiz section binds to whichever unit precedes it in the document.
    const quizSection = QUIZ_SECTION_RE.exec(line);
    if (quizSection) {
      if (!unit) return { error: `quiz before any unit: ${quizSection[1]}` };
      if (quiz) sections.push(quiz);
      quiz = { title: quizSection[1], unit: unit.n, items: [] };
      item = null;
      continue;
    }

    const question = QUESTION_RE.exec(line);
    if (question) {
      if (!quiz) return { error: `question before any quiz section: ${question[1]}` };
      item = { prompt: question[1].trim(), accepts: [], hints: [], steps: [], cites: [] };
      quiz.items.push(item);
      continue;
    }

    const field = ITEM_FIELD_RE.exec(raw);
    if (field && quiz && item) {
      const key = field[1].toLowerCase();
      const value = field[2].trim();
      if (key === "answer") item.answer = value;
      else if (key === "accepts") item.accepts.push(...value.split("|").map((v) => v.trim()).filter(Boolean));
      else if (key === "hint") item.hints.push(value);
      else if (key === "step") item.steps.push(value);
      else if (key === "cite") item.cites.push(value);
      continue;
    }

    const groupMatch = GROUP_RE.exec(line);
    if (groupMatch) {
      if (!unit) return { error: `group before any unit: ${groupMatch[1]}` };
      group = { title: groupMatch[1], modules: [] };
      unit.groups.push(group);
      continue;
    }

    const labSection = LAB_SECTION_RE.exec(line);
    if (labSection) {
      if (!unit) return { error: `interactive before any unit: ${labSection[2]}` };
      if (lab) labSections.push(lab);
      lab = {
        title: labSection[2],
        unit: unit.n,
        // A Game section implies the kind unless the body says otherwise.
        raw: { kind: labSection[1].toLowerCase() === "game" ? "target-window" : "slider" },
      };
      quiz = null;
      item = null;
      continue;
    }

    const labField = LAB_FIELD_RE.exec(raw);
    if (labField) {
      const key = labField[1].toLowerCase();
      const value = labField[2].trim();
      if (key === "kind") lab.raw.kind = value;
      else if (key === "fn") lab.raw.fn = value;
      else if (key === "caption") lab.raw.caption = value;
      else if (key === "cites") lab.raw.cites = value.split(",").map((c) => c.trim()).filter(Boolean);
      else if (key === "xrange") {
        const [a, b] = value.split("|").map((v) => Number(v.trim()));
        lab.raw.xRange = [a, b];
      } else if (key === "speed") lab.raw.speed = Number(value);
      else if (key === "band") {
        const [a, b] = value.split("|").map((v) => Number(v.trim()));
        lab.raw.band = [a, b];
      } else if (key === "param") {
        const [name, min, max, step, val] = value.split("|").map((v) => v.trim());
        const params = (lab.raw.params as unknown[]) ?? [];
        params.push({ name, min: Number(min), max: Number(max), step: Number(step), value: Number(val) });
        lab.raw.params = params;
      }
      continue;
    }

    const moduleMatch = MODULE_RE.exec(line);
    if (moduleMatch) {
      if (!unit) return { error: `module before any unit: ${moduleMatch[2]}` };
      const type = moduleMatch[1];
      if (!isModuleType(type)) return { error: `unknown module type: ${type}` };
      const rest = moduleMatch[2];
      const refMatch = REF_RE.exec(rest);
      const refSlug = refMatch ? slug(refMatch[1]) : null;
      const card = refSlug ? conceptByName.get(refSlug) : undefined;
      if (refSlug && !card) warnings.push(WARN.unknownLesson(refMatch![1]));

      const label = rest.replace(REF_RE, "").replace(/\s{2,}/g, " ").trim();
      const module: Module = {
        id: `${slug(unit.title)}/${slug(label) || type}`,
        type,
        title: label || type,
      };
      if (refSlug) {
        module.concept = card ? card.name : refMatch![1];
        module.badge = card?.badge;
        module.mastery = card ? masteryOf(card.badge) : MASTERY_UNKNOWN;
        // Only set when the reference is dangling: the field means "names a card that does not
        // exist", so a resolved reference leaves it absent rather than false.
        if (!card) module.missing = true;
        else {
          unit.concepts.push(card.name);
          module.due = card.due;
        }
      }
      if (!group) {
        group = { title: "Lessons", modules: [] };
        unit.groups.push(group);
      }
      group.modules.push(module);
      continue;
    }

    const quizMatch = QUIZ_RE.exec(line);
    if (quizMatch) {
      if (!unit) return { error: "quiz before any unit" };
      if (!group) {
        group = { title: "Assessment", modules: [] };
        unit.groups.push(group);
      }
      group.modules.push({
        id: `${slug(unit.title)}/quiz`,
        type: "quiz",
        title: `${unit.title} quiz`,
        items: Number(quizMatch[1]),
      });
      continue;
    }
  }

  if (units.length === 0) return { error: "no units declared" };
  if (quiz) sections.push(quiz);
  if (lab) labSections.push(lab);

  const authoredLabs = labSections.map((s) => ({
    id: slug(s.title),
    title: s.title,
    unit: s.unit,
    // Validated in buildCourse, where the course kind and the filesystem are known.
    spec: s.raw as unknown as Spec,
  }));

  const authoredQuizzes: Quiz[] = sections
    // An empty section is a declaration the tutor should fill, not a broken quiz.
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      id: slug(s.title),
      title: s.title,
      unit: s.unit,
      // Items are validated in buildCourse, where the course kind and the filesystem are known.
      items: s.items as unknown as AssessmentItem[],
      source: "authored" as const,
    }));

  // unit mastery follows from the concepts it references, so an authored unit is not
  // forced to invent a mastery value
  for (const u of units) {
    const cards = u.concepts
      .map((name) => conceptByName.get(slug(name)))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    u.mastery = aggregateMastery(cards.map((c) => masteryOf(c.badge)));
  }

  return {
    units,
    quizzes: authoredQuizzes,
    interactives: authoredLabs,
    kind: kindMatch?.[1] === "codebase" ? "codebase" : "topic",
    title: titleMatch?.[1],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Loading a course from disk
// ---------------------------------------------------------------------------

export function courseSourceFrom(
  dir: string,
  id: string,
  read: (path: string) => string | null,
  parse: (dir: string) => LearningData,
): CourseSource {
  const withSlash = dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}/`;
  return {
    id,
    dir,
    data: parse(dir),
    schemaText: read(`${withSlash}.agent/learning/SCHEMA.md`),
    manifestText: read(`${withSlash}.agent/learning/COURSE.md`),
  };
}

export { SEVERITIES, severityState };
