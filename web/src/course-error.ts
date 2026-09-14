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

/**
 * Group 1 — turn any server failure into something a learner can read.
 *
 * `web/src/api.ts` lifts `body.error` verbatim into a thrown `Error`, and components rendered
 * `err.message` unchanged, so learners read developer text: raw `JSON.stringify` quotes
 * (`that subject has no usable letters or digits: "!!! ???"`), filesystem paths, and internal phrasings
 * like `unknown course: <slug>`. Eight sites did this.
 *
 * ONE place maps, deliberately: `courseErrorView` above already existed for the course-load case, so this
 * is its sibling rather than a second pattern. `messageFor` is the general path; `courseErrorView` stays
 * for the two pages that want the rename-aware heading.
 *
 * THE DIAGNOSTIC IS NOT SWALLOWED. `humanMessage` returns copy for the learner, and the raw string is
 * preserved by the caller (it is already in the thrown Error and in the server's log) — the learner sees
 * copy, the developer keeps the evidence.
 */

/**
 * A filesystem path, a stack frame, or a quote-wrapped payload — the three things that must never reach
 * a learner. Used both to write the copy and to assert it in tests.
 */
export function looksLikeDeveloperText(text: string): boolean {
  const windowsPath = /[A-Za-z]:\\/.test(text);
  const posixPath = /(^|\s)\/(?:home|Users|var|tmp)\//.test(text);
  const stackFrame = /\bat\s+\S+\s*\(/.test(text);
  const quotedPayload = /:\s*"[\s\S]*"$/.test(text.trim());
  return windowsPath || posixPath || stackFrame || quotedPayload;
}

/** Known server phrasings and what to say instead. Ordered: the first match wins. */
const MAPPINGS: { match: RegExp; human: (m: RegExpExecArray) => string }[] = [
  {
    // `that subject has no usable letters or digits: "!!! ???"`
    match: /no usable letters or digits/i,
    human: () =>
      "That name needs at least one letter or number — punctuation and symbols alone will not work.",
  },
  {
    // `a course called "x" already exists` / `a title whose slug already exists`
    match: /a course called "([^"]+)" already exists|already exists/i,
    human: (m) =>
      m[1]
        ? `There is already a course called “${m[1]}”. Pick a different name.`
        : "That name is already taken. Pick a different one.",
  },
  {
    match: /a subject is required|a title is required|title is required/i,
    human: () => "Give it a name first.",
  },
  {
    match: /title is \d+ characters; the limit is (\d+)/i,
    human: (m) => `That name is too long — keep it under ${m[1]} characters.`,
  },
  {
    match: /unknown course:?\s*([^\s"]*)/i,
    human: (m) =>
      m[1]
        ? `There is no course called “${m[1]}” any more. It may have been renamed.`
        : "That course could not be found. It may have been renamed.",
  },
  {
    match: /a turn for another course is active/i,
    human: () => "The tutor is still working on another course. Wait for it to finish.",
  },
  {
    match: /a chat turn is already in progress|an SSE stream is already active/i,
    human: () => "The tutor is still answering. Wait for that reply first.",
  },
  {
    match: /chat is disabled/i,
    human: () => "The tutor is switched off in this build.",
  },
  {
    match: /could not reach the server|failed to fetch|networkerror/i,
    human: () => "Could not reach the app. Check that it is still running, then try again.",
  },
  {
    match: /no such session|no learning folder|no MISSION\.md|has no MISSION/i,
    human: () => "That record is not there any more.",
  },
  {
    match: /timed out|did not finish within/i,
    human: () => "The tutor took too long to answer. Try again.",
  },
  {
    match: /HTTP 5\d\d|internal/i,
    human: () => "Something went wrong on our side. Try again.",
  },
];

/**
 * The learner-facing message for a failure of any kind.
 *
 * Unknown failures fall back to a human, non-empty sentence — never the raw string. The raw text is
 * available on the thrown Error for logs and tests; this function is only for display.
 */
export function humanMessage(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (!text) return "Something went wrong. Try again.";
  for (const { match, human } of MAPPINGS) {
    const m = match.exec(text);
    if (m) return human(m);
  }
  // A path or a stack is never shown, whatever it says.
  if (looksLikeDeveloperText(text)) return "Something went wrong. Try again.";
  // Anything else is short and unrecognised; show it, trimmed of a trailing quoted payload, so a genuine
  // sentence from the server still reaches the learner.
  return text.replace(/:\s*"[\s\S]*"$/, ".").slice(0, 200);
}
