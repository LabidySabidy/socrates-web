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
import { useEffect, useRef, useState } from "react";
import { fetchCourse } from "../api.ts";
import type { CourseTree, Unit } from "../types.ts";
import { hrefCourse, hrefLesson } from "../router.ts";

import { emptyTurn, isSilent, reduceTurn, splitTurn, type TurnState } from "../turn.ts";
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
  onExit,
}: {
  courseId: string;
  unitNumber: number;
  /** A prompt to dispatch on arrival — how a tray or rail click starts a grill. */
  ask?: string | null;
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

  const streamRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** A dispatched grill fires exactly once, however many times the component re-renders. */
  const dispatched = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
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

  const unit: Unit | null = tree?.units.find((u) => u.n === unitNumber) ?? tree?.units[0] ?? null;
  const { thinking, prose: rawProse } = splitTurn(turn);
  // Everything from a gate token onward is a control signal, not content.
  const { prose, token } = splitAtGate(rawProse);
  const frozen = isFrozen(gateOpen, remaining);

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
    setInput("");
    setBusy(true);
    setError(null);
    setTurn(emptyTurn());

    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The course travels with the prompt: it decides which directory the tutor runs in.
        body: JSON.stringify({ message, course: courseId }),
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

    es.onmessage = (ev) => {
      const raw: string = ev.data;
      if (raw === "[DONE]") {
        es.close();
        if (streamRef.current === es) streamRef.current = null;
        setBusy(false);
        return;
      }
      if (raw.startsWith("[ERROR]")) {
        setError(raw.slice(7).trim());
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
      if (parsed?.type === "message_update" && parsed.assistantMessageEvent) {
        setTurn((prev) => reduceTurn(prev, parsed!.assistantMessageEvent));
      }
    };

    es.onerror = () => {
      es.close();
      if (streamRef.current === es) streamRef.current = null;
      setBusy(false);
    };
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
              <span aria-current="page">{unit.title}</span>
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
          <h1 className="display lesson-title">{unit?.title ?? "Lesson"}</h1>

          {error ? (
            <p className="notice" role="status">
              {error}
            </p>
          ) : null}

          <details className="reasoning" open={thinking.length > 0}>
            <summary>View Socratic Reasoning</summary>
            <div className="reasoning-body">{thinking || "No reasoning recorded for this turn."}</div>
          </details>

          {prose ? (
            <div className="prose reading">{prose}</div>
          ) : busy ? (
            <p className="presence">Socrates is thinking…</p>
          ) : (
            <div className="prose reading lesson-intro">
              <p>
                This activity is a live session with the tutor. Ask a question, or explain the
                concept back in your own words — the tutor&rsquo;s reasoning appears in the drawer
                above, and its reply here.
              </p>
            </div>
          )}

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
          disabled={busy || frozen || !input.trim()}
        >
          {busy ? "Waiting…" : frozen ? "Resting…" : "Send"}
        </button>
      </div>

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

