/**
 * course-error.ts — what a learner reads when a course cannot be loaded.
 *
 * A raw server string is not an error message. `unknown course: bicycle-wheel-truing-and-tensioning` is
 * the API's internal phrasing, and it reached the screen verbatim — with no way back, and no explanation
 * of the most likely reason, which is that the course was RENAMED while the learner was sitting in it.
 *
 * The mapping is intentionally small and honest: it names a cause only when the server's own text says
 * so, and otherwise repeats what happened without inventing a story.
 */

export interface CourseErrorView {
  /** A short heading a person would write. */
  heading: string;
  /** One sentence: what happened, in plain language. */
  detail: string;
  /** True when the cause looks like a rename, so the copy can point at the library rather than blame. */
  renamed: boolean;
}

/**
 * Turn a thrown API error into something to show.
 *
 * `unknown course: X` is the one shape with a likely explanation worth stating, because a rename is the
 * only way a course id goes stale while the app is open. Everything else is passed through as the detail
 * — labelled as a problem loading the course rather than misattributed to a rename.
 */
export function courseErrorView(raw: string): CourseErrorView {
  const message = raw.trim();
  const unknown = /^unknown course:?\s*/i.exec(message);
  if (unknown) {
    const id = message.slice(unknown[0].length).trim();
    return {
      heading: "That course has moved",
      detail: id
        ? `There is no course at "${id}" any more. Courses are renamed when their title changes, so a page still holding the old name cannot find it.`
        : "There is no course at that address any more. It may have been renamed.",
      renamed: true,
    };
  }
  return {
    heading: "Course unavailable",
    detail: message || "The course could not be loaded.",
    renamed: false,
  };
}

/**
 * B2 — should this rename frame move the page?
 *
 * Extracted from the effect so the rule is testable without a DOM, because it has four conditions that
 * each exist for a reason and a wrong answer is a silent navigation:
 *
 *  - only the page holding the OLD id moves (`from === courseId`);
 *  - a rename never interrupts a turn in flight (the tutor would go on writing into a directory the page
 *    has left, and the reply would land on a screen that no longer shows the course);
 *  - one navigation per (from, to) pair, so a re-delivered frame cannot double-navigate;
 *  - a frame with no destination is not a rename.
 */
export function shouldFollowRename(input: {
  from: string;
  to: string;
  courseId: string;
  busy: boolean;
  alreadyFollowed: string | null;
}): boolean {
  const { from, to, courseId, busy, alreadyFollowed } = input;
  if (!from || !to) return false;
  if (from !== courseId) return false;
  if (busy) return false;
  return alreadyFollowed !== `${from}->${to}`;
}
