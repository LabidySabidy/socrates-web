/**
 * learning-parser.ts — zero-dependency markdown parser for the Socrates-Web
 * learning suite. Reads MISSION.md, PLAN.md, SCHEMA.md from a project's
 * .agent/learning/ directory and returns one structured, JSON-serializable object.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Badge = "⬜" | "🟥" | "🟨" | "🟩" | "🟦";

export const BADGE_LABEL: Record<Badge, string> = {
  "⬜": "Unmeasured",
  "🟥": "Weak",
  "🟨": "Fair",
  "🟩": "Good",
  "🟦": "Mastered",
};

/**
 * Misconception severity — shared format with the learning extension.
 *
 * Three ACTIVE ratings may be stored; `resolved` and `unrated` are display states derived
 * from status + emptiness. Distinct from the mastery scale: severity describes how a belief
 * is wrong, mastery describes how well a concept is known.
 *
 * Severity is tutor-emitted. It is never inferred from the misconception prose — a blank
 * cell means unrated, and that must stay honest.
 */
export const SEVERITIES = ["root", "partial", "edge"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type SeverityState = Severity | "resolved" | "unrated";

export const SEVERITY_LABEL: Record<SeverityState, string> = {
  root: "Root",
  partial: "Partial",
  edge: "Edge",
  resolved: "Resolved",
  unrated: "Unrated",
};

/** Colour is applied as a stroke (dot + label), never a fill — per the design system. */
export const SEVERITY_COLOR: Record<SeverityState, string | null> = {
  root: "#c83f3f",
  partial: "#d97706",
  edge: "#d4a72c",
  resolved: "#c9c6bd",
  unrated: null,
};

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/** Collapse the stored pair into the five-state display value. */
export function severityState(
  status: "open" | "resolved",
  severity: Severity | "" | undefined,
): SeverityState {
  if (status === "resolved") return "resolved";
  return severity && isSeverity(severity) ? severity : "unrated";
}

export interface Sm2 {
  last_tested: string;
  next_review: string;
  interval: number | null;
  ease_factor: number | null;
  repetitions: number | null;
}

export interface Concept {
  name: string;
  badge: Badge;
  label: string;
  sm2: Sm2;
  due: "due" | "upcoming" | "unscheduled";
}

export interface Misconception {
  id: string;
  concept: string;
  misconception: string;
  corrected: string;
  status: "open" | "resolved";
  date: string;
  /** `""` when the 7th column is blank or absent — backward compatible with 6-column tables. */
  severity: Severity | "";
  /** The five-state display value, derived so the UI never re-implements the rule. */
  severityState: SeverityState;
}

export interface SequenceItem {
  n: number;
  skill: string;
  why: string;
  hours: string;
}

export interface Mission {
  /**
   * The course NAME — the H1, which is the one place a title lives. Everything else the app shows or
   * navigates by (slug, directory, URL, catalogue) is derived from it.
   *
   * Resolution order is H1 → destination → directory name; `parseMission` can only see the first two,
   * so `parseLearning` applies the directory fallback and the chain is complete by the time anything
   * reads `mission.title`.
   */
  title: string;
  destination: string;
  artifact: string;
  drivingProject: string;
}

export interface Plan {
  sequence: SequenceItem[];
  cutList: string[];
}

export interface LearningData {
  projectDir: string;
  present: string[];
  mission: Mission;
  plan: Plan;
  schema: {
    concepts: Concept[];
    misconceptions: Misconception[];
  };
}

const FILE_NAMES = ["MISSION.md", "PLAN.md", "SCHEMA.md"] as const;

function read(dir: string, name: string): string {
  try {
    return readFileSync(join(dir, name), "utf8");
  } catch {
    return "";
  }
}

function isBadge(v: string): v is Badge {
  return v in BADGE_LABEL;
}

function num(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function dueOf(nextReview: string): "due" | "upcoming" | "unscheduled" {
  if (!nextReview || nextReview === "—") return "unscheduled";
  return nextReview <= isoToday() ? "due" : "upcoming";
}

/**
 * Split a markdown table row into cells, preserving empty middle cells.
 * Drops only the two structural empties produced by the leading and trailing
 * pipe characters — never .filter(Boolean), which shifts columns left.
 */
function parseMarkdownRow(line: string): string[] {
  const cells = line.split("|").map((s) => s.trim());
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells;
}

export function parseMission(text: string): Mission {
  const grab = (label: string): string => {
    const marker = `**${label}**`;
    for (const line of text.split("\n")) {
      const i = line.indexOf(marker);
      if (i !== -1) return line.slice(i + marker.length).trim();
    }
    return "";
  };
  const destination = grab("I will be able to:");
  return {
    // The H1, or "" so the caller can fall back. Only a REAL heading counts: `#` inside a fenced
    // block or a `#hashtag` at line start must not become a course name.
    title: grabTitle(text) || destination,
    destination,
    artifact: grab("Proof-of-skill artifact:"),
    drivingProject: grab("Driving project / pain:"),
  };
}

/**
 * The first ATX H1 in the document, with the legacy `Mission — ` prefix stripped.
 *
 * Courses created before the title existed were seeded as `# Mission — <subject>`; those files are on
 * disk in archives and on other machines, so the prefix is dropped rather than allowed to leak into a
 * course name (and therefore into a directory name).
 */
export function grabTitle(text: string): string {
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    return m[1].replace(/^Mission\s+[\u2014\u2013-]\s*/i, "").trim();
  }
  return "";
}

export function parsePlan(text: string): Plan {
  const sequence: SequenceItem[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^\|\s*\d+\s*\|/.test(t)) {
      const cells = parseMarkdownRow(t);
      if (cells.length >= 2) {
        sequence.push({
          n: sequence.length + 1,
          skill: cells[1] ?? "",
          why: cells[2] ?? "",
          hours: cells[3] ?? "",
        });
      }
    }
  }
  const cutList: string[] = [];
  const cutSection = text.split(/^## Cut List\s*$/m)[1];
  if (cutSection) {
    const cutBody = cutSection.split(/^##\s/m)[0];
    for (const line of cutBody.split("\n")) {
      const t = line.trim();
      if (/^-\s*(?:\*\*)?(Cut|Defer)/.test(t)) {
        cutList.push(t.replace(/^- /, ""));
      }
    }
  }
  return { sequence, cutList };
}

export function parseSchema(text: string): {
  concepts: Concept[];
  misconceptions: Misconception[];
} {
  // emoji as alternation, never a [] class (surrogate pairs); /u = unicode-safe
  const headingRe = /^### ((?:⬜|🟥|🟨|🟩|🟦)) (.+)$/gmu;
  const matches: { badge: string; name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    matches.push({ badge: m[1], name: m[2].trim(), index: m.index });
  }

  const concepts: Concept[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const card = text.slice(cur.index, next);
    const get = (field: string): string => {
      const mm = card.match(new RegExp("`" + field + "`: (.+)"));
      return mm ? mm[1].trim() : "—";
    };
    const nextReview = get("next_review");
    const badge: Badge = isBadge(cur.badge) ? cur.badge : "⬜";
    concepts.push({
      name: cur.name,
      badge,
      label: BADGE_LABEL[badge],
      sm2: {
        last_tested: get("last_tested"),
        next_review: nextReview,
        interval: num(get("interval")),
        ease_factor: num(get("ease_factor")),
        repetitions: num(get("repetitions")),
      },
      due: dueOf(nextReview),
    });
  }

  const misconceptions: Misconception[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!/^\| MIS-\d+ \|/.test(t)) continue;
    const cells = parseMarkdownRow(t);
    if (cells.length >= 5) {
      const status: "open" | "resolved" = cells[4] === "resolved" ? "resolved" : "open";
      const rawSeverity = (cells[6] ?? "").trim();
      const severity: Severity | "" = isSeverity(rawSeverity) ? rawSeverity : "";
      misconceptions.push({
        id: cells[0],
        concept: cells[1],
        misconception: cells[2],
        corrected: cells[3] ?? "",
        status,
        date: cells[5] ?? "",
        severity,
        severityState: severityState(status, severity),
      });
    }
  }
  return { concepts, misconceptions };
}

export function parseLearning(projectDir: string): LearningData {
  const dir = join(projectDir, ".agent", "learning");
  const present = FILE_NAMES.filter((n) => existsSync(join(dir, n)));
  const mission = parseMission(read(dir, "MISSION.md"));
  // The last link of the fallback chain. `parseMission` is pure text and cannot know the directory,
  // so a course with no H1 and no destination still lists by the name of the folder it lives in.
  if (!mission.title) mission.title = basename(projectDir);
  return {
    projectDir,
    present,
    mission,
    plan: parsePlan(read(dir, "PLAN.md")),
    schema: parseSchema(read(dir, "SCHEMA.md")),
  };
}
