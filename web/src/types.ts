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
  | "recite"
  | "review"
  | "explain"
  | "misconceptions"
  | "article"
  | "video"
  | "practice"
  | "quiz"
  | "test"
  | "interact"
  | "game"
  | "project";

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

export interface LearningData {
  projectDir: string;
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
