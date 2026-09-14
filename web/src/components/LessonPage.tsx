/**
 * LessonPage — the chat-first lesson console.
 *
 * Layout follows the reference: eyebrow, title, a collapsed Socratic Reasoning drawer fed by the
 * tutor's thinking, unboxed prose, then a pinned composer. Streamed from the REAL pi bridge via
 * POST /api/chat + GET /api/stream — no scripted token stream.
 *
 * Exit Lesson returns to the originating course and unit (both are in the route) and restores the
 * module pane's scroll position.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchContinuity,
  fetchCourse,
  fetchHistory,
  fetchSessionStatus,
  type ContinuityResponse,
  type SessionStatus,
} from "../api.ts";
import type { CourseTree, Unit } from "../types.ts";
import { hrefCourse, hrefHome, hrefLesson } from "../router.ts";
import { resolveUnit } from "../unit-selection.ts";
import { courseErrorView, humanMessage, shouldFollowRename } from "../course-error.ts";
import { useCourseWatch } from "../watch.ts";
import { lessonModeOf, openingPrompt } from "../grill.ts";

import { emptyTurn, isSilent, reduceTurn, splitTurn, streamErrorText, type TurnState } from "../turn.ts";
import { humanize } from "../humanize.ts";
import { appendUser, settleAssistant, type ChatTurn } from "../transcript.ts";
import {
  isPassiveText,
  isPassivitySignal,
  maySubmit,
  PASSIVITY_MESSAGE,
  refusalReason,
} from "../passivity.ts";
interface ChatResponse {
  accepted?: boolean;
  course?: string;
  switched?: boolean;
  error?: string;
}

export function LessonPage({
  courseId,
  unitNumber,
  ask,
  arrival,
  budapest = false,
  onExit,
}: {
  courseId: string;
  /** The unit the URL asked for, or undefined when it asked for none (G2). */
  unitNumber: number | undefined;
  /** A prompt to dispatch on arrival — how a tray or rail click starts a grill. */
  ask?: string | null;
  /**
   * A counter that changes on every navigation to this lesson, so a repeat click on the same module is
   * a new arrival rather than an ignored re-render.
   */
  arrival: number;
  /** Budapest mode: the SERVER injects the modifier, so the message stays unpolluted. */
  budapest?: boolean;
  onExit: () => void;
}) {
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [turn, setTurn] = useState<TurnState>(emptyTurn);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * D3 — the tutor's own status. A lesson whose tutor cannot start must say so where the composer is,
   * rather than offering a box that silently does nothing.
   */
  const [tutor, setTutor] = useState<SessionStatus | null>(null);
  /** 3a — progress, badges and resolved misconceptions carried across sittings. */
  const [continuity, setContinuity] = useState<ContinuityResponse | null>(null);
  /**
   * E1 — the rest gate is not wired. `restgate.ts` implements the mechanic and its tests still pin it, but
   * NOTHING emits the `COGNITIVE SPRINT GATE` token: verified against the original (`06cee66^`), where the
   * token appears only at its own definition (`app.js:25`) while the consumer reads it out of the model's
   * stream (`app.js:126-128`). The producer never existed in either app, so a 300-second freeze was never
   * reachable and is removed rather than left looking intentional.
   *
   * The pure module is kept deliberately: it is the only record of what the mechanic was meant to do, and
   * if the idea is ever reintroduced it should arrive WITH a producer. Re-adding this state without one
   * would recreate dead code, which is why the reason is here rather than in a commit message.
   */
  /** The tutor's passivity intercept. Active until a real explanation is sent. */
  const [intercept, setIntercept] = useState(false);
  /**
   * Settled turns. The original rendered the learner's message the moment it was sent
   * (`append("user", message)`, 06cee66^:public/app.js:181) and kept it in the transcript; without
   * this the console showed only the tutor, so a sent explanation left no visible trace.
   */
  const [history, setHistory] = useState<ChatTurn[]>([]);


  const streamRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** A dispatched prompt fires exactly once per arrival, however many times the component re-renders. */
  const dispatched = useRef<string | null>(null);
  /**
   * Which arrival this is. Bumped by the router on every navigation (App keys the page on the route
   * sequence), so the SAME `?ask=` clicked twice is two arrivals and re-fires, while one arrival that
   * re-renders is one key.
   */
  const askGeneration = arrival;
  /**
   * B4 — the error must not survive a navigation. A stale id left "unknown course: …" on screen even
   * after the learner moved to the correct lesson, so the message outlived the problem it described.
   * Cleared whenever the route's course or unit changes.
   */
  useEffect(() => {
    setError(null);
  }, [courseId, unitNumber]);

  useEffect(() => {
    let alive = true;
    fetchSessionStatus()
      .then((s) => {
        if (alive) setTutor(s);
      })
      .catch(() => {
        /* an unreachable status endpoint leaves the composer as it was; the chat will say so */
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * B2 — one navigation per rename, and never while a turn is running.
   *
   * `busy` is read through a ref because the SSE handler that receives the frame is created once per
   * turn and closes over the `busy` of that moment; reading state directly would decide with a stale
   * value. A rename mid-turn would strand the reply in flight, so it is ignored and the next read
   * reconciles anyway.
   */
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const followedRename = useRef<string | null>(null);

  /**
   * 2a — the tutor opens the lesson.
   *
   * No lesson could start itself, so learners typed "hey, are you there?" into an empty console. Once the
   * unit's state is known (continuity + restored history), if the learner arrived with no intent of their
   * own and nothing settled on screen, the tutor speaks first. The route is decided by `lessonMode` from
   * the learner's real state, not by the model.
   */
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!continuity || !tree) return;
    if (ask) return; // the learner arrived with intent; the dispatch effect owns it
    if (history.length > 0) return; // something is already settled on screen
    if (busy) return;
    const key = `${courseId}#${unitNumber}#${continuity.sessions.length}`;
    if (openedFor.current === key) return;
    openedFor.current = key;

    const concept = unit?.title ?? null;
    const standing = concept
      ? continuity.concepts.find((c) => c.concept === concept) ?? null
      : null;
    const priorSessions = concept
      ? continuity.sessions.filter((s) => s.concepts.includes(concept)).length
      : 0;
    const miscon = concept
      ? continuity.sessions
          .flatMap((s) => s.misconceptions)
          .filter((m) => m.concept === concept)
          .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
          .map((m) => ({ id: m.id, summary: m.summary, sinceResolved: m.sinceResolved }))
      : [];

    const mode = lessonModeOf(standing, priorSessions > 0);
    void send(
      openingPrompt({
        concept,
        mode,
        priorSessions,
        mastery: standing?.mastery ?? null,
        misconceptions: miscon,
      }),
      "opening",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the unit's state is known
  }, [continuity, tree, ask, history.length, busy, courseId, unitNumber]);

  useEffect(() => {
    let alive = true;
    setTree(null);
    // 1a/1c — restore the settled transcript. Without this a refresh dropped everything the learner and
    // the tutor had said, while the data sat untouched in pi's session file. Only SETTLED turns come
    // back; a turn cut off mid-stream was dropped server-side rather than marked, because a half-turn
    // rendered like a finished reply cannot be told from one.
    setHistory([]);
    Promise.all([
      fetchCourse(courseId),
      fetchHistory(courseId).catch(() => ({ turns: [], session: null, truncated: false })),
      fetchContinuity(courseId).catch(() => null),
    ])
      .then(([t, h, c]) => {
        if (!alive) return;
        setTree(t);
        setHistory(h.turns);
        setContinuity(c);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [courseId]);

  /**
   * B1 — follow a rename while the learner is sitting in the lesson.
   *
   * This is exactly where they are when the scaffold names the course: the interview runs here, the
   * tutor writes the H1, the directory moves, and the id this page holds goes stale. The course page
   * already followed it; without this the lesson stayed on a dead URL and a refresh showed the server's
   * raw string.
   */
  useCourseWatch(
    useCallback(() => {
      /* a reload frame for a course we no longer hold by that id — the rename frame carries the move */
    }, []),
    true,
    useCallback(
      (from: string, to: string) => {
        const follow = shouldFollowRename({
          from,
          to,
          courseId,
          busy: busyRef.current,
          alreadyFollowed: followedRename.current,
        });
        if (!follow) return;
        followedRename.current = `${from}->${to}`;
        // Assigning the hash FIRES `hashchange`, which is what the router listens for — `replaceState`
        // would move the URL without the route ever re-parsing, so the page would keep the old tree. The
        // unit is preserved, so the learner stays on the concept they were working on.
        window.location.hash = hrefLesson(to, unitNumber ?? unit?.n ?? 1).slice(1);
        setTree(null);
      },
      [courseId, unitNumber],
    ),
  );

  // G2 — the resolution is a decision, not a fallback expression: "no unit asked for" defaults to the
  // first, while "a unit that does not exist" is reported as such rather than silently showing unit 1.
  const resolution = tree ? resolveUnit(tree.units, unitNumber) : null;
  const unit: Unit | null =
    resolution && (resolution.kind === "found" || resolution.kind === "default") ? resolution.unit : null;
  const outOfRange = resolution?.kind === "out-of-range" ? resolution : null;
  /** A unit number safe to print: never exponential, never fractional, never a number the course lacks. */
  const unitLabel = unit ? String(unit.n) : null;
  const { thinking, prose: rawProse } = splitTurn(turn);
  // Everything from a gate token onward is a control signal, not content.
  const prose = rawProse; // no gate token to split on: see the note above
  const blocked = refusalReason(intercept, input) === "passive";
  const tutorDown = tutor !== null && tutor.chat && !tutor.ok;
  const canSend = maySubmit(intercept, input) && !busy && !tutorDown;

  /**
   * Dispatch an arriving prompt: seed the composer so the learner can SEE what is being asked on their
   * behalf, then send it.
   *
   * TWO BUGS THIS REPLACES, both reproduced:
   *
   * 1. `replaceState` stripped `?ask=` immediately, so a refresh or the back button lost the intent
   *    entirely — the URL no longer said what the learner had clicked.
   * 2. `dispatched.current === ask` was never reset, so clicking the same module a second time was a
   *    silent no-op: the guard meant to stop double-firing also stopped re-firing.
   *
   * The fix separates "has this been dispatched in THIS visit" from "is a dispatch pending at all". A
   * key is `<ask>#<generation>`, and the generation bumps whenever the route's ask changes or the learner
   * arrives fresh — so a repeat click (a new navigation event with the same text) is a new key and
   * re-fires, while a re-render of the same visit is not. The async work is guarded by the same key, so
   * React's development double-invoke and a fast re-render cannot send twice.
   */
  const dispatchKey = ask ? `${ask}#${askGeneration}` : null;
  useEffect(() => {
    if (!ask || !dispatchKey || dispatched.current === dispatchKey) return;
    dispatched.current = dispatchKey;
    setInput(ask);
    // The ask is NOT stripped from the URL: it is the only record of what the learner clicked, and a
    // refresh has to be able to re-derive it. It is harmless to leave because `dispatched.current` stops
    // a re-fire within the same visit.
    void send(ask, "dispatch");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the dispatch key only
  }, [dispatchKey]);

  function exit() {
    // The course page saves its own scroll offset on the way in (there is no .pane here).
    streamRef.current?.close();
    streamRef.current = null;
    onExit();
  }

  async function send(explicit?: string, origin?: ChatTurn["origin"]) {
    const message = (explicit ?? input).trim();
    if (!message || busy) return;
    // BEHAVIOUR CHANGE: the original banner never blocked. This refuses a passive draft while the
    // tutor has signalled the intercept, and clears it once a real explanation goes out.
    if (!maySubmit(intercept, message)) return;
    if (intercept && !isPassiveText(message)) setIntercept(false);
    setInput("");
    setBusy(true);
    setError(null);
    setTurn(emptyTurn());
    // Appended BEFORE the reply, exactly as the original did.
    setHistory((h) => appendUser(h, message, origin));

    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The course travels with the prompt: it decides which directory the tutor runs in. Budapest
        // travels as a MODE, not as text appended here — the original concatenated it onto the
        // message (app.js:184), which polluted the prompt, the transcript and the event log.
        body: JSON.stringify({ message, course: courseId, mode: budapest ? "budapest" : "default" }),
      });
    } catch {
      setError("could not reach the server");
      setBusy(false);
      return;
    }

    const body = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok || !body.accepted) {
      setError(body.error ?? `message rejected (HTTP ${res.status})`);
      setBusy(false);
      return;
    }

    streamRef.current?.close();
    const es = new EventSource(`/api/stream?course=${encodeURIComponent(courseId)}`);
    streamRef.current = es;

    // Accumulated SYNCHRONOUSLY in the handler, not read back from React state. A ref mirrored by an
    // effect can still be stale when the settle frame arrives in the same burst as the last delta,
    // which settled an empty turn and made the tutor's reply vanish.
    let proseSoFar = "";

    es.onmessage = (ev) => {
      const raw: string = ev.data;
      if (raw === "[DONE]") {
        es.close();
        if (streamRef.current === es) streamRef.current = null;
        // Settle the turn into the transcript so the next one starts clean.
        setHistory((h) => settleAssistant(h, proseSoFar));
        setTurn(emptyTurn());
        setBusy(false);
        return;
      }
      if (raw.startsWith("[ERROR]")) {
        setError(streamErrorText(raw));
        es.close();
        if (streamRef.current === es) streamRef.current = null;
        setBusy(false);
        return;
      }
      let parsed: { type?: string; assistantMessageEvent?: unknown } | null = null;
      try {
        parsed = JSON.parse(raw) as { type?: string; assistantMessageEvent?: unknown };
      } catch {
        return; // a non-JSON line (e.g. raw stdout) is not part of the turn
      }
      if (isPassivitySignal(parsed)) {
        // Trigger preserved: the TUTOR signals passivity, the client never diagnoses it.
        setIntercept(true);
        return;
      }
      if (parsed?.type === "message_update" && parsed.assistantMessageEvent) {
        const delta = parsed.assistantMessageEvent as { type?: string; delta?: unknown };
        if (delta.type === "text_delta" && typeof delta.delta === "string") {
          proseSoFar += delta.delta;
        }
        setTurn((prev) => reduceTurn(prev, parsed!.assistantMessageEvent));
      }
    };

    es.onerror = () => {
      es.close();
      if (streamRef.current === es) streamRef.current = null;
      setBusy(false);
    };
  }

  // B3 — a course that never loaded gets a real state: a sentence a person would write, and a way back.
  // Checked as `error && !tree` so a CHAT error (which arrives with a tree already on screen) keeps the
  // inline notice and the composer stays usable — only a course that could not be read at all takes over
  // the page. The raw server string is never shown; `courseErrorView` names a cause only when the
  // server's own text does.
  // G2 — a unit that does not exist. It is NOT unit 1's content under a different label: the learner asked
  // for something this course does not have, so the page says so and offers the units it does.
  if (outOfRange && tree) {
    return (
      <div className="lesson">
        <nav className="lesson-bar" aria-label="Lesson">
          <a href={hrefCourse(courseId)} onClick={exit}>
            {tree.title}
          </a>
          <span aria-hidden="true"> › </span>
          <span>Not found</span>
        </nav>
        <main className="page">
          <h1 className="display greeting">There is no unit here</h1>
          <p className="greeting-sub reading">
            {outOfRange.requested > 0
              ? `This course has ${outOfRange.available.length} unit${outOfRange.available.length === 1 ? "" : "s"}, so there is no unit ${outOfRange.requested}.`
              : `That is not a unit in this course — it has ${outOfRange.available.length} unit${outOfRange.available.length === 1 ? "" : "s"}.`}
          </p>
          <p>
            <a className="primary" href={hrefLesson(courseId, outOfRange.available[0])}>
              Start at unit {outOfRange.available[0]}
            </a>
          </p>
        </main>
      </div>
    );
  }

  if (error && !tree) {
    const view = courseErrorView(error);
    return (
      <main className="page">
        <h1 className="display greeting">{view.heading}</h1>
        <p className="greeting-sub reading">{view.detail}</p>
        {view.renamed ? (
          <p className="reading">
            Your courses are listable from the library, where the current name is.
          </p>
        ) : null}
        <p>
          <a className="primary" href={hrefHome()}>
            ← Back to the library
          </a>
        </p>
      </main>
    );
  }

  return (
    <div className="lesson">
      <nav className="lesson-bar" aria-label="Lesson">
        <span className="crumbs">
          <a href={hrefCourse(courseId, unitNumber ?? unit?.n ?? 1)} onClick={exit}>
            {tree?.title ?? courseId}
          </a>
          <span aria-hidden="true"> › </span>
          {unitLabel ? <span>Unit {unitLabel}</span> : null}
          {unit ? (
            <>
              <span aria-hidden="true"> › </span>
              <span aria-current="page">{humanize(unit.title)}</span>
            </>
          ) : null}
        </span>
        <button type="button" onClick={exit}>
          Exit Lesson
        </button>
      </nav>

      <div className="lesson-scroll" ref={scrollRef}>
        <div className="console" id="main-content" tabIndex={-1}>
          <div className="eyebrow">AI activity · {tree?.title ?? courseId}</div>
          <h1 className="display lesson-title">{humanize(unit?.title ?? "Lesson")}</h1>

          {error ? (
            <p className="notice" role="status">
              {humanMessage(error)}
            </p>
          ) : null}

          <details className="reasoning" open={thinking.length > 0}>
            <summary>View Socratic Reasoning</summary>
            <div className="reasoning-body">{thinking || "No reasoning recorded for this turn."}</div>
          </details>

          {history.map((m, i) =>
            m.role === "user" ? (
              // A turn the APP dispatched is not the learner's words. Rendering it in `.msg-user` showed
              // them a slash command and scripted first-person text they never wrote (C2). It is still
              // visible — the tutor's question should be readable — but as an app action, not as speech.
              m.origin ? (
                <div className={`msg-dispatch ${m.origin}`} key={i}>
                  <span className="eyebrow">
                    {m.origin === "opening" ? "Socrates opened this lesson" : "Asked for you"}
                  </span>
                  <span className="dispatch-note">
                    {m.origin === "opening"
                      ? "A recap and a question to start from."
                      : "The tutor was asked to start this with you."}
                  </span>
                </div>
              ) : (
                <div className="msg-user" key={i}>
                  {m.text}
                </div>
              )
            ) : (
              <div className="prose reading" key={i}>
                {m.text}
              </div>
            ),
          )}

          {prose ? (
            <div className="prose reading">{prose}</div>
          ) : busy ? (
            <p className="presence">Socrates is thinking…</p>
          ) : history.length === 0 ? (
            <div className="prose reading lesson-intro">
              <p>
                This activity is a live session with the tutor. Ask a question, or explain the
                concept back in your own words — the tutor&rsquo;s reasoning appears in the drawer
                above, and its reply here.
              </p>
            </div>
          ) : null}

          {isSilent(turn) && !busy && prose === "" ? null : null}
        </div>
      </div>

      {tutorDown ? (
        <div className="tutor-down" role="alert">
          <p>
            <strong>The tutor cannot start.</strong>{" "}
            {tutor!.problems[0] ?? "Its session could not be composed."}
          </p>
          {tutor!.problems.length > 1 ? (
            <ul>
              {tutor!.problems.slice(1).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <p className="eyebrow">
            This app runs its own tutor session and never falls back to your global pi install, so the
            lesson will stay silent until this is fixed.
          </p>
        </div>
      ) : null}

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask a question, or explain it back in your own words…"
          aria-label="Message the tutor"
          rows={1}
          disabled={busy || tutorDown}
        />
        <button
          type="button"
          className="primary"
          onClick={() => void send()}
          disabled={!canSend}
          title={blocked ? "Write a real explanation before sending" : undefined}
        >
          {busy ? "Waiting…" : blocked ? "Explain it" : "Send"}
        </button>
      </div>

      {intercept ? (
        <div className="passivity" role="status">
          <p>{PASSIVITY_MESSAGE}</p>
          {blocked ? (
            <p className="passivity-gate">
              Sending is paused until this is a real explanation. This is a change from the original
              intercept, which only displayed a banner.
            </p>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

