/**
 * quiz.ts — the quiz state machine, kept pure so every branch is testable without a browser.
 *
 * Mirrors the reference design's behaviour:
 *   - one problem at a time, sticky footer with "N of M" and progress dots
 *   - the primary action label cycles Check → Try again → Next → Finish
 *   - hints are revealed one at a time with a 1/3 → 3/3 counter, and Skip is withdrawn once wrong
 *   - the two-mistake mastery gate opens on the second mistake in an attempt, offering
 *     "Start over" (a full reset) or "Keep going" (dismiss)
 */
import { isCorrect, type AssessmentItem } from "./assessment-types.ts";

export type DotState = "right" | "wrong" | "current" | "pending";
export type Feedback = "none" | "correct" | "incorrect";

/** Mistakes in one attempt before the mastery gate opens. */
export const MISTAKE_LIMIT = 2;

export interface QuizState {
  index: number;
  count: number;
  answer: string;
  /** The current item has been answered correctly. */
  locked: boolean;
  /** The last attempt was wrong. */
  wrong: boolean;
  mistakes: number;
  totalMistakes: number;
  hintsShown: number;
  gateOpen: boolean;
  feedback: Feedback;
  solutionOpen: boolean;
  done: boolean;
  dots: DotState[];
}

export function initQuiz(count: number): QuizState {
  return {
    index: 0,
    count,
    answer: "",
    locked: false,
    wrong: false,
    mistakes: 0,
    totalMistakes: 0,
    hintsShown: 0,
    gateOpen: false,
    feedback: "none",
    solutionOpen: false,
    done: count === 0,
    dots: Array.from({ length: count }, (_, i) => (i === 0 ? "current" : "pending")),
  };
}

export function setAnswer(state: QuizState, value: string): QuizState {
  if (state.locked) return state;
  return { ...state, answer: value };
}

/** Check the current answer. Correct locks the item; wrong records a mistake and may open the gate. */
export function check(state: QuizState, item: AssessmentItem | undefined): QuizState {
  if (!item || state.locked || state.done) return state;
  if (state.answer.trim() === "") return state;

  if (isCorrect(item, state.answer)) {
    return {
      ...state,
      locked: true,
      wrong: false,
      feedback: "correct",
      dots: withDot(state.dots, state.index, "right"),
    };
  }

  const mistakes = state.mistakes + 1;
  return {
    ...state,
    wrong: true,
    mistakes,
    totalMistakes: state.totalMistakes + 1,
    feedback: "incorrect",
    // The gate opens on the second mistake, and only while the item is still unsolved.
    gateOpen: mistakes >= MISTAKE_LIMIT,
    dots: withDot(state.dots, state.index, "wrong"),
  };
}

/** "Try again": clear the wrong state so the answer can be edited. */
export function tryAgain(state: QuizState): QuizState {
  if (!state.wrong) return state;
  return { ...state, wrong: false, feedback: "none" };
}

export function showHint(state: QuizState, item: AssessmentItem | undefined): QuizState {
  const max = item?.hints.length ?? 0;
  if (state.hintsShown >= max) return state;
  return { ...state, hintsShown: state.hintsShown + 1 };
}

export function showSolution(state: QuizState): QuizState {
  return { ...state, solutionOpen: true };
}

/** Advance to the next item, or finish if this was the last one. */
export function next(state: QuizState): QuizState {
  if (state.done) return state;
  if (state.index + 1 >= state.count) return { ...state, done: true, gateOpen: false };
  const index = state.index + 1;
  return {
    ...state,
    index,
    answer: "",
    locked: false,
    wrong: false,
    mistakes: 0,
    hintsShown: 0,
    gateOpen: false,
    feedback: "none",
    solutionOpen: false,
    dots: state.dots.map((d, i) => (i === index ? "current" : d === "current" ? "pending" : d)),
  };
}

/** "Start over" from the gate: a full reset of index, dots, mistakes and hints. */
export function restart(state: QuizState): QuizState {
  return initQuiz(state.count);
}

/** "Keep going" from the gate. */
export function dismissGate(state: QuizState): QuizState {
  return { ...state, gateOpen: false };
}

/** Which action the sticky footer's primary button offers. */
export function actionLabel(state: QuizState): "Check" | "Try again" | "Next" | "Finish" {
  if (state.locked) return state.index + 1 >= state.count ? "Finish" : "Next";
  if (state.wrong) return "Try again";
  return "Check";
}

/** Skip is withdrawn once the learner has been wrong on this item. */
export function canSkip(state: QuizState): boolean {
  return !state.wrong && !state.locked;
}

export function score(state: QuizState): { right: number; wrong: number } {
  return {
    right: state.dots.filter((d) => d === "right").length,
    wrong: state.dots.filter((d) => d === "wrong").length,
  };
}

function withDot(dots: DotState[], index: number, value: DotState): DotState[] {
  return dots.map((d, i) => (i === index ? value : d));
}
