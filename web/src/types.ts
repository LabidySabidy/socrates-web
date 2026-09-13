/**
 * types.ts — the client's view of the server contract.
 * Shapes mirror `course-model.ts` / `courses.ts`; the server is the source of truth.
 */

export type MasteryState = "Not started" | "Attempted" | "Familiar" | "Proficient" | "Mastered";

export interface Mastery {
  state: MasteryState;
  color: string;
  ring: number;
}

export type ModuleType =
  // derived
  | "recite"
  | "review"
  | "explain"
  | "misconceptions"
  // authored
  | "article"
  | "video"
  | "practice"
  | "quiz"
  | "test"
  | "course-challenge"
  | "primary-source"
  | "faq"
  | "interact"
  | "game"
  | "project"
  | "ai-activity";

export interface Module {
  id: string;
  type: ModuleType;
  title: string;
  concept?: string;
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
  concepts: string[];
  authored?: boolean;
}

export interface Mission {
  destination: string;
  artifact: string;
  drivingProject: string;
}

export interface Plan {
  sequence: { n: number; skill: string; why: string; hours: string }[];
  cutList: string[];
}

export interface CourseTree {
  id: string;
  dir: string;
  title: string;
  kind: "topic" | "codebase";
  derived: boolean;
  warnings: string[];
  mission: Mission;
  plan: Plan;
  units: Unit[];
  mastery: { counts: Record<MasteryState, number>; aggregate: Mastery; total: number };
}

export interface CourseRef {
  id: string;
  dir: string;
  label: string;
  title: string;
  hidden: boolean;
  order: number | null;
  concepts: number;
  /** Per-state counts over the course's unique concept cards, for the catalogue metrics. */
  masteryCounts: Record<MasteryState, number>;
  /** Session recency, from the SESSIONS file names — no log reads. */
  sessions: { count: number; lastAt: string | null };
  /** A course must have been INITIATED: `.agent/learning/MISSION.md` exists. */
  initiated: boolean;
  kind: "topic" | "codebase";
  fromScan: boolean;
  fromRegistry: boolean;
}

export interface CoursesResponse {
  root: string | null;
  registry: string;
  warnings: string[];
  courses: CourseRef[];
}

export interface Misconception {
  id: string;
  concept: string;
  misconception: string;
  corrected: string;
  status: "open" | "resolved";
  date: string;
  severity: Severity | "";
  severityState: SeverityState;
}

export type Severity = "root" | "partial" | "edge";
export type SeverityState = Severity | "resolved" | "unrated";

export interface LearningData {  projectDir: string;
  present: string[];
  mission: Mission;
  plan: Plan;
  schema: {
    concepts: {
      name: string;
      badge: string;
      label: string;
      due: string;
      sm2: {
        last_tested: string;
        next_review: string;
        interval: number | null;
        ease_factor: number | null;
        repetitions: number | null;
      };
    }[];
    misconceptions: Misconception[];
  };
}

/** One session in a course's journal. Content comes from SESSIONS/*.md, not the raw event log. */
export interface SessionSummary {
  file: string;
  startedAt: string;
  endedAt: string | null;
  open: boolean;
  turns: number | null;
  concepts: string[];
  misconceptions: number;
  gaps: number;
  transcript: string | null;
  bytes: number;
}

export interface Journal {
  id: string;
  dir: string;
  sessions: SessionSummary[];
  events: {
    present: boolean;
    count: number;
    malformed: number;
    lastTs: string | null;
    telemetryMissing: number;
  };
  warnings: string[];
}

/** One directory in the server-side folder browser. Directories only, by design. */
export interface DirEntry {
  name: string;
  path: string;
  /** Has `.agent/learning/` — registration will be accepted. */
  isCourse: boolean;
  /** Has `MISSION.md` — a course the user actually started. */
  initiated: boolean;
}

export interface BrowseResult {
  path: string | null;
  parent: string | null;
  entries: DirEntry[];
}
