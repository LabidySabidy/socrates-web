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
import { fetchCourse } from "../api.ts";
import type { CourseTree, Unit } from "../types.ts";
import { hrefCourse, hrefHome, hrefLesson } from "../router.ts";
import { courseErrorView, shouldFollowRename } from "../course-error.ts";
import { useCourseWatch } from "../watch.ts";

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
import {
  formatCountdown,
  isFrozen,
  REST_BODY,
  REST_HEADING,
  REST_SECONDS,
  splitAtGate,
} from "../restgate.ts";

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
  budapest = false,
  onExit,
}: {
  courseId: string;
  unitNumber: number;
  /** A prompt to dispatch on arrival — how a tray or rail click starts a grill. */
  ask?: string | null;
  /** Budapest mode: the SERVER injects the modifier, so the message stays unpolluted. */
  budapest?: boolean;
  onExit: () => void;
}) {
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [turn, setTurn] = useState<TurnState>(emptyTurn);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The sprint gate: 300 seconds of frozen composer, no backend state. */
  const [gateOpen, setGateOpen] = useState(false);
  const [remaining, setRemaining] = useState(REST_SECONDS);
  const gateSeen = useRef(false);
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
  /** A dispatched grill fires exactly once, however many times the component re-renders. */
  const dispatched = useRef<string | null>(null);
  /**
   * B4 — the error must not survive a navigation. A stale id left "unknown course: …" on screen even
   * after the learner moved to the correct lesson, so the message outlived the problem it described.
   * Cleared whenever the route's course or unit changes.
   */
  useEffect(() => {
    setError(null);
  }, [courseId, unitNumber]);

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

  useEffect(() => {
    let alive = true;
    setTree(null);
    fetchCourse(courseId)
      .then((t) => {
        if (alive) setTree(t);
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
        window.location.hash = hrefLesson(to, unitNumber).slice(1);
        setTree(null);
      },
      [courseId, unitNumber],
    ),
  );

  const unit: Unit | null = tree?.units.find((u) => u.n === unitNumber) ?? tree?.units[0] ?? null;
  const { thinking, prose: rawProse } = splitTurn(turn);
  // Everything from a gate token onward is a control signal, not content.
  const { prose, token } = splitAtGate(rawProse);
  const frozen = isFrozen(gateOpen, remaining);
  const blocked = refusalReason(intercept, input) === "passive";
  const canSend = maySubmit(intercept, input) && !busy && !frozen;

  // Open once, on the first turn that carries a token.
  useEffect(() => {
    if (!token || gateSeen.current) return;
    gateSeen.current = true;
    setGateOpen(true);
    setRemaining(REST_SECONDS);
    setBusy(false);
  }, [token]);

  // The countdown owns its interval and clears it on unmount, like the original's restTimer.
  useEffect(() => {
    if (!gateOpen) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          setGateOpen(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [gateOpen]);

  // Dispatch an arriving prompt once: seed the composer so the learner can SEE what is being asked on
  // their behalf, then send it. The param is stripped from the URL so a reload cannot re-fire it.
  useEffect(() => {
    if (!ask || dispatched.current === ask) return;
    dispatched.current = ask;
    setInput(ask);
    // Strip the ask but STAY on the lesson: replaceState does not re-route, so writing the course
    // route here left the URL describing a different screen than the one on display.
    window.history.replaceState(null, "", hrefLesson(courseId, unitNumber));
    void send(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the ask value only
  }, [ask, courseId, unitNumber]);

  function exit() {
    gateSeen.current = false;
    // The course page saves its own scroll offset on the way in (there is no .pane here).
    streamRef.current?.close();
    streamRef.current = null;
    onExit();
  }

  async function send(explicit?: string) {
    const message = (explicit ?? input).trim();
    if (!message || busy) return;
    // The gate is a freeze, not a suggestion — same as the original's setBusy(true).
    if (frozen) return;
    // BEHAVIOUR CHANGE: the original banner never blocked. This refuses a passive draft while the
    // tutor has signalled the intercept, and clears it once a real explanation goes out.
    if (!maySubmit(intercept, message)) return;
    if (intercept && !isPassiveText(message)) setIntercept(false);
    setInput("");
    setBusy(true);
    setError(null);
    setTurn(emptyTurn());
    // Appended BEFORE the reply, exactly as the original did.
    setHistory((h) => appendUser(h, message));

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
          <a href={hrefCourse(courseId, unitNumber)} onClick={exit}>
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
        <button type="button" onClick={exit}>
          Exit Lesson
        </button>
      </nav>

      <div className="lesson-scroll" ref={scrollRef}>
        <div className="console">
          <div className="eyebrow">AI activity · {tree?.title ?? courseId}</div>
          <h1 className="display lesson-title">{humanize(unit?.title ?? "Lesson")}</h1>

          {error ? (
            <p className="notice" role="status">
              {error}
            </p>
          ) : null}

          <details className="reasoning" open={thinking.length > 0}>
            <summary>View Socratic Reasoning</summary>
            <div className="reasoning-body">{thinking || "No reasoning recorded for this turn."}</div>
          </details>

          {history.map((m, i) =>
            m.role === "user" ? (
              <div className="msg-user" key={i}>
                {m.text}
              </div>
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
          disabled={busy || frozen}
        />
        <button
          type="button"
          className="primary"
          onClick={() => void send()}
          disabled={!canSend}
          title={blocked ? "Write a real explanation before sending" : undefined}
        >
          {busy ? "Waiting…" : frozen ? "Resting…" : blocked ? "Explain it" : "Send"}
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

      {gateOpen ? (
        <div className="scrim" role="dialog" aria-modal="true" aria-label={REST_HEADING}>
          <div className="gate rest-gate">
            <h2 className="display">{REST_HEADING}</h2>
            <p className="reading">{REST_BODY}</p>
            <div className="countdown num" aria-live="off">
              {formatCountdown(remaining)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

