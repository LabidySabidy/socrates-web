/**
 * learning-parser.ts — zero-dependency markdown parser for the Socrates-Web
 * learning suite. Reads MISSION.md, PLAN.md, SCHEMA.md from a project's
 * .agent/learning/ directory and returns one structured, JSON-serializable object.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Badge = "⬜" | "🟥" | "🟨" | "🟩" | "🟦";

export const BADGE_LABEL: Record<Badge, string> = {
  "⬜": "Unmeasured",
  "🟥": "Weak",
  "🟨": "Fair",
  "🟩": "Good",
  "🟦": "Mastered",
};

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
}

export interface SequenceItem {
  n: number;
  skill: string;
  why: string;
  hours: string;
}

export interface Mission {
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

export function parseMission(text: string): Mission {
  const grab = (label: string): string => {
    const marker = `**${label}**`;
    for (const line of text.split("\n")) {
      const i = line.indexOf(marker);
      if (i !== -1) return line.slice(i + marker.length).trim();
    }
    return "";
  };
  return {
    destination: grab("I will be able to:"),
    artifact: grab("Proof-of-skill artifact:"),
    drivingProject: grab("Driving project / pain:"),
  };
}

export function parsePlan(text: string): Plan {
  const sequence: SequenceItem[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^\|\s*\d+\s*\|/.test(t)) {
      const cells = t.split("|").map((s) => s.trim()).filter(Boolean);
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
  // emoji as alternation, never a [] class (surrogate pairs)
  const headingRe = /^### ((?:⬜|🟥|🟨|🟩|🟦)) (.+)$/gm;
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
    const cells = t.split("|").map((s) => s.trim()).filter(Boolean);
    if (cells.length >= 5) {
      misconceptions.push({
        id: cells[0],
        concept: cells[1],
        misconception: cells[2],
        corrected: cells[3] ?? "",
        status: cells[4] === "resolved" ? "resolved" : "open",
        date: cells[5] ?? "",
      });
    }
  }
  return { concepts, misconceptions };
}

export function parseLearning(projectDir: string): LearningData {
  const dir = join(projectDir, ".agent", "learning");
  const present = FILE_NAMES.filter((n) => existsSync(join(dir, n)));
  return {
    projectDir,
    present,
    mission: parseMission(read(dir, "MISSION.md")),
    plan: parsePlan(read(dir, "PLAN.md")),
    schema: parseSchema(read(dir, "SCHEMA.md")),
  };
}
