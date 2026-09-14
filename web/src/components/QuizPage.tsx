/**
 * QuizPage — one problem at a time, with the reference design's branches:
 * Check → Try again → Next → Finish, progressive hints, the two-mistake mastery gate, feedback
 * toasts, and a completion panel.
 *
 * All state transitions live in `quiz.ts`; this file only renders them.
 */
import { useEffect, useState } from "react";
import { fetchAssessments, fetchCourse, generateAssessments, recordResult } from "../api.ts";
import { completionView, type CompletionView } from "../completion.ts";
import type { AssessmentsResponse } from "../assessment-types.ts";
import type { CourseTree, Unit } from "../types.ts";
import { hrefCourse, hrefHome } from "../router.ts";
import {
  actionLabel,
  canSkip,
  check as checkAnswer,
  dismissGate,
  initQuiz,
  judge,
  next as nextItem,
  restart,
  reveal,
  score,
  setAnswer,
  showHint,
  showSolution,
  tryAgain,
  type QuizState,
} from "../quiz.ts";
import { gradingMode } from "../assessment-types.ts";
import { humanize } from "../humanize.ts";
import { humanMessage, materialFailureView } from "../course-error.ts";

export function QuizPage({
  courseId,
  unitNumber,
  onExit,
}: {
  courseId: string;
  unitNumber: number;
  onExit: () => void;
}) {
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [data, setData] = useState<AssessmentsResponse | null>(null);
  const [state, setState] = useState<QuizState>(() => initQuiz(0));
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [completion, setCompletion] = useState<CompletionView | null>(null);
  /** B2a — who to blame and whether to offer a retry. Set by the classification, not hardcoded. */
  const [material, setMaterialError] = useState<ReturnType<typeof materialFailureView> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([fetchCourse(courseId), fetchAssessments(courseId, unitNumber)])
      .then(([t, a]) => {
        if (!alive) return;
        setTree(t);
        setData(a);
        setState(initQuiz(a.items.length));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // B2a — this catch covers BOTH fetches, so it cannot assume the quiz is what failed. The
        // classifier decides who to blame and whether a retry is worth offering.
        const view = materialFailureView(err, "quiz");
        setMaterialError(view);
        setData({
          unit: unitNumber,
          source: "none",
          items: [],
          warnings: [],
          error: view.heading,
          detail: view.detail,
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [courseId, unitNumber]);

  const unit: Unit | null = tree?.units.find((u) => u.n === unitNumber) ?? null;
  const item = data?.items[state.index];
  const selfCheck = item ? gradingMode(item) === "self-check" : false;
  const label = data && data.items.length > 0 ? actionLabel(state, item) : null;

  // Toasts auto-dismiss, matching the reference's 5s quiz toast.
  useEffect(() => {
    if (state.feedback === "correct") setToast("There you go! Keep it up!");
    else if (state.feedback === "incorrect") setToast("Not quite! Give it another try!");
    else setToast(null);
    if (state.feedback === "none") return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [state.feedback, state.index]);

  // Record the attempt once, when the quiz finishes. The screen renders only what came back.
  useEffect(() => {
    if (!state.done || !data || data.items.length === 0) return;
    let alive = true;
    const result = score(state);
    recordResult(courseId, {
      unit: unitNumber,
      source: data.source,
      right: result.right,
      wrong: result.wrong,
      total: state.count,
      itemIds: data.items.map((i) => i.id),
    })
      .then((res) => {
        if (!alive) return;
        setCompletion(
          completionView({
            right: result.right,
            wrong: result.wrong,
            total: state.count,
            recorded: res.recorded === true,
            mastery: res.mastery,
            pendingBadge: res.pendingBadge ?? null,
            recordError: res.recorded ? null : (res.error ?? "unknown error"),
          }),
        );
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setCompletion(
          completionView({
            right: result.right,
            wrong: result.wrong,
            total: state.count,
            recorded: false,
            recordError: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    return () => {
      alive = false;
    };
  }, [state.done, courseId, unitNumber, data]);

  async function generate() {
    setGenerating(true);
    const result = await generateAssessments(courseId, unitNumber, 3);
    setGenerating(false);
    if (result.error) {
      setData(result);
      return;
    }
    setData(result);
    setState(initQuiz(result.items.length));
  }

  function primary() {
    if (!item) return;
    switch (label) {
      case "Show solution":
        // Self-check: reveal, never grade. The learner decides.
        setState((s) => reveal(s, item));
        return;
      case "Check":
        setState((s) => checkAnswer(s, item));
        return;
      case "Try again":
        setState((s) => tryAgain(s));
        return;
      case "Next":
        setState((s) => nextItem(s));
        return;
      case "Finish":
        setState((s) => nextItem(s));
        return;
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p className="greeting-sub reading">Loading quiz…</p>
      </main>
    );
  }

  // A failed generation shows WHY. It never renders a partly built quiz.
  if (data?.error) {
    return (
      <div className="lesson">
        <nav className="lesson-bar" aria-label="Quiz">
          <span className="crumbs">
            <a href={hrefCourse(courseId, unitNumber)} onClick={onExit}>
              {tree?.title ?? courseId}
            </a>
            <span aria-hidden="true"> › </span>
            <span>Unit {unitNumber}</span>
          </span>
          <button type="button" onClick={onExit}>
            Exit Lesson
          </button>
        </nav>
        <main className="page">
          {/* B2a — the headline comes from the CLASSIFICATION, so a course that cannot be read is not
              reported as a quiz problem. `material` is set by the catch; on a generation failure the
              heading names the quiz, which is correct. */}
          <h1 className="display greeting">{material?.heading ?? "This quiz could not be prepared"}</h1>
          <p className="greeting-sub reading">{humanMessage(data.detail ?? data.error)}</p>
          {/* A SUMMARY of what arrived, never the model's text: when it has produced items that text IS
              the answer key. A `p`, not a `pre` — this is a sentence, not a code sample. */}
          {data.excerpt ? <p className="notice excerpt-summary">{data.excerpt}</p> : null}
          <div className="quiz-actions">
            {/* Offered ONLY when regenerating could help. A course that cannot be read is not fixed by
                generating again, so the remedy is the link back below, not this button. */}
            {material?.retryable !== false ? (
              <button type="button" className="primary" onClick={() => void generate()} disabled={generating}>
                {generating ? "Generating…" : "Try generating again"}
              </button>
            ) : null}
            <a className="primary" href={hrefHome()}>
              ← Back to the library
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="lesson">
        <nav className="lesson-bar" aria-label="Quiz">
          <span className="crumbs">
            <a href={hrefCourse(courseId, unitNumber)} onClick={onExit}>
              {tree?.title ?? courseId}
            </a>
            <span aria-hidden="true"> › </span>
            <span>Unit {unitNumber}</span>
          </span>
          <button type="button" onClick={onExit}>
            Exit Lesson
          </button>
        </nav>
        <main className="page">
          <h1 className="display greeting">No quiz yet</h1>
          <p className="greeting-sub reading">
            This unit has no authored quiz. The tutor can write one for{" "}
            {unit ? `“${humanize(unit.title)}”` : "this unit"}, grounded in the concept cards.
          </p>
          <div className="quiz-actions">
            <button type="button" className="primary" onClick={() => void generate()} disabled={generating}>
              {generating ? "Generating…" : "Generate a quiz"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (state.done) {
    const result = score(state);
    // Until the recording round-trips, the screen says nothing about the attempt.
    const view =
      completion ?? completionView({ right: result.right, wrong: result.wrong, total: state.count, recorded: false });
    return (
      <div className="lesson">
        <nav className="lesson-bar" aria-label="Quiz">
          <span className="crumbs">
            <a href={hrefCourse(courseId, unitNumber)} onClick={onExit}>
              {tree?.title ?? courseId}
            </a>
            <span aria-hidden="true"> › </span>
            <span>Unit {unitNumber}</span>
          </span>
          <button type="button" onClick={onExit}>
            Exit Lesson
          </button>
        </nav>
        <main className="page quiz-done">
          <div className="eyebrow">Quiz complete · {data.source} quiz</div>
          <h1 className="display">{view.heading}</h1>
          {/* A mastery line renders ONLY when the response carried a mastery value. Nothing writes
              one today, so nothing is claimed — the score and the recording are the whole story. */}
          {view.masteryLine ? <p className="reading quiz-mastery">{view.masteryLine}</p> : null}
          <p className="reading">{view.scoreLine}</p>
          {view.recordedLine ? <p className="reading quiz-recorded">{view.recordedLine}</p> : null}
          {view.pendingLine ? <p className="reading quiz-pending">{view.pendingLine}</p> : null}
          <div className="quiz-actions">
            <button type="button" className="primary" onClick={() => setState(restart(state))}>
              Start over
            </button>
            <button type="button" onClick={onExit}>
              Back to the unit
            </button>
          </div>
        </main>
      </div>
    );
  }

  const hintsRemaining = item ? item.hints.length - state.hintsShown : 0;

  return (
    <div className="lesson">
      <nav className="lesson-bar" aria-label="Quiz">
        <span className="crumbs">
          <a href={hrefCourse(courseId, unitNumber)} onClick={onExit}>
            {tree?.title ?? courseId}
          </a>
          <span aria-hidden="true"> › </span>
          <span>Unit {unitNumber}</span>
          {unit ? (
            <>
              <span aria-hidden="true"> › </span>
              <span aria-current="page">{humanize(unit.title)}</span>
            </>
          ) : null}
        </span>
        <span className="lesson-bar-right">
          <span className="eyebrow quiz-source">
            {data.source === "authored" ? "authored quiz" : data.source === "generated" ? "generated quiz" : "cached quiz"}
          </span>
          <button type="button" onClick={onExit}>
            Exit Lesson
          </button>
        </span>
      </nav>

      <div className="lesson-scroll">
        <div className="quiz">
          <div className="eyebrow">{unit ? `Unit ${unit.n} · ${humanize(unit.title)}` : "Quiz"}</div>
          <h1 className="display quiz-prompt">{item?.prompt}</h1>

          <div className="quiz-input-row">
            {selfCheck ? (
              <textarea
                className={`quiz-input quiz-prose${state.locked ? " locked" : ""}`}
                value={state.answer}
                onChange={(e) => setState((s) => setAnswer(s, e.target.value))}
                placeholder="Write your answer in your own words, then compare it with the solution"
                aria-label="Your answer"
                rows={3}
                disabled={state.locked}
              />
            ) : (
              <input
                className={`quiz-input${state.wrong ? " wrong" : ""}${state.locked ? " locked" : ""}`}
                value={state.answer}
                onChange={(e) => setState((s) => setAnswer(s, e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") primary();
                }}
                placeholder="Answer"
                aria-label="Your answer"
                disabled={state.locked}
              />
            )}
          </div>

          {selfCheck ? (
            <p className="eyebrow quiz-selfcheck">
              Not auto-graded — this one is prose, so you judge it. Comparing your answer with the
              solution is the exercise.
            </p>
          ) : null}

          {selfCheck && state.solutionOpen && !state.locked && item ? (
            <div className="quiz-verdict" role="group" aria-label="Your own verdict">
              <span className="eyebrow">How did you do?</span>
              <button type="button" className="primary" onClick={() => setState((s) => judge(s, true))}>
                I got it right
              </button>
              <button type="button" onClick={() => setState((s) => judge(s, false))}>
                I didn&rsquo;t get it
              </button>
            </div>
          ) : null}

          {(state.locked || state.solutionOpen) && item ? (
            <div className="quiz-solution">
              {state.locked && !state.solutionOpen ? (
                <button type="button" className="link" onClick={() => setState((s) => showSolution(s))}>
                  See a step-by-step solution
                </button>
              ) : null}
              {state.solutionOpen ? (
                <ol className="steps">
                  {item.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          {state.hintsShown > 0 && item ? (
            <div className="hints">
              <div className="eyebrow">
                Hint {state.hintsShown}/{item.hints.length}
              </div>
              <ol className="steps">
                {item.hints.slice(0, state.hintsShown).map((hint, i) => (
                  <li key={i}>{hint}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {state.wrong && hintsRemaining > 0 ? (
            <button type="button" className="hints-toggle" onClick={() => setState((s) => showHint(s, item))}>
              {state.hintsShown === 0 ? "Hints" : `Next hint (${state.hintsShown}/${item!.hints.length})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="quiz-foot">
        <span className="eyebrow">
          {state.index + 1} of {state.count}
        </span>
        <span className="dots" aria-label="Progress">
          {state.dots.map((dot, i) => (
            <span key={i} className={`dot ${dot}`} aria-hidden="true" />
          ))}
        </span>
        <span className="spacer" />
        {canSkip(state) ? (
          <button type="button" onClick={() => setState((s) => nextItem(s))}>
            Skip
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          onClick={primary}
          disabled={!state.locked && !selfCheck && state.answer.trim() === ""}
        >
          {label}
        </button>
      </div>

      {toast ? (
        <div className={`quiz-toast ${state.feedback}`} role="status">
          {toast}
        </div>
      ) : null}

      {state.gateOpen ? (
        <div className="scrim" role="dialog" aria-modal="true" aria-label="Mastery gate">
          <div className="gate">
            <h2 className="display">Would you like to start over?</h2>
            <p className="reading">
              You can no longer reach &ldquo;Proficient&rdquo; on this attempt. You can keep going or
              start over. Start over is available after two mistakes.
            </p>
            <div className="quiz-actions">
              <button type="button" className="primary" onClick={() => setState((s) => restart(s))}>
                Start over
              </button>
              <button type="button" onClick={() => setState((s) => dismissGate(s))}>
                Keep going
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
