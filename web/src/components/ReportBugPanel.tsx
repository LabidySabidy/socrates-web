/**
 * ReportBugPanel.tsx — capture a defect at the moment it is seen.
 *
 * DOCKED, NOT MODAL. The owner is usually mid-read when they notice something, and a modal covering the page
 * makes it impossible to describe what is under it. This is a bottom sheet: the page stays visible above it,
 * which is the whole reason it is not a dialog.
 *
 * ESCAPE, AND WHAT HAPPENS TO A DRAFT (1c). Two different situations, deliberately treated differently:
 *   - EMPTY draft: Escape closes silently. There is nothing to lose.
 *   - NON-EMPTY draft: Escape asks first ("Discard this draft?"). Losing a half-written bug report to a
 *     stray keypress is worse than one extra click, and the owner's stated intent is that a report survives
 *     to be reviewed later — a draft that vanishes on Escape defeats that before it is even sent.
 */
import { useEffect, useRef, useState } from "react";
import { postReport } from "../api.ts";
import { captureSupported, frameWithinCap, dataUrlBytes, MAX_IMAGE_BYTES, type Frame } from "../capture.ts";

/** The app's own build identity, so a report can be tied to the bundle it came from. */
function appVersion(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script?.src.split("/").pop() ?? null;
}

export function ReportBugPanel({
  onClose,
  route,
  course,
  unit,
  transcript,
}: {
  onClose: () => void;
  /** The hash at capture time. */
  route: string;
  course: string | null;
  unit: number | null;
  /** The current unit's conversation, offered as an attachment. Empty when there is nothing to attach. */
  transcript: { role: "user" | "assistant"; text: string }[];
}) {
  /**
   * ONE field, not two. The owner asked for this directly: "I just want one field that I can capture all of
   * those insights." Two boxes forced a decision about which one an observation belonged in, while capturing
   * tends to produce one paragraph that mentions the fault AND what was expected. `expected` stays in the
   * stored shape (the API and the store are unchanged) and is simply empty, so nothing downstream moves.
   */
  const [whatIsWrong, setWhatIsWrong] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const [attachTranscript, setAttachTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLTextAreaElement | null>(null);

  const hasDraft = whatIsWrong.trim().length > 0;

  // Capture once, when the panel opens. The dialog appears on every capture; that is expected and the copy
  // below says so, because an unexplained permission prompt reads as something being wrong.
  useEffect(() => {
    firstField.current?.focus();
    let alive = true;
    if (!captureSupported()) {
      setCaptureNote("Screen capture is not available here, so this report will be text only.");
      return;
    }
    void import("../capture.ts").then(async ({ captureFrame }) => {
      const result = await captureFrame();
      if (!alive) return;
      if (!result.ok) {
        // THE ORDINARY CASE for anyone who dismisses the dialog. The report stays submittable.
        setCaptureNote(`No screenshot attached — ${result.reason}. You can still save the report.`);
        return;
      }
      if (!frameWithinCap(result.frame)) {
        setCaptureNote(
          `No screenshot attached — it was ${(dataUrlBytes(result.frame.dataUrl) / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit. The report can still be saved.`,
        );
        return;
      }
      setFrame(result.frame);
      setCaptureNote(null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Escape closes, asking first when there is something to lose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (hasDraft && !confirmDiscard) {
        setConfirmDiscard(true);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasDraft, confirmDiscard, onClose]);

  async function retake() {
    setCaptureNote("Capturing…");
    const { captureFrame } = await import("../capture.ts");
    const result = await captureFrame();
    if (!result.ok) {
      setCaptureNote(`No screenshot attached — ${result.reason}. You can still save the report.`);
      return;
    }
    // REPLACES rather than appending: a second frame on one report would be ambiguous.
    setFrame(result.frame);
    setCaptureNote(null);
  }

  function save() {
    if (!whatIsWrong.trim() || busy) return;
    setBusy(true);
    setError(null);
    void postReport({
      whatIsWrong,
      expected: "",
      route,
      course,
      unit,
      appVersion: appVersion(),
      imageBase64: frame ? frame.dataUrl.replace(/^data:image\/png;base64,/, "") : null,
      transcript: attachTranscript && transcript.length > 0 ? transcript : null,
    }).then((res) => {
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? "could not save the report");
        return;
      }
      setSaved(res.id ?? "saved");
    });
  }

  if (saved) {
    return (
      <aside className="report-sheet" role="region" aria-label="Bug report saved">
        <p className="report-saved">
          Saved. <a href="#/reports">Review reports</a> to see it with the others.
        </p>
        <button type="button" className="primary" onClick={onClose}>
          Close
        </button>
      </aside>
    );
  }

  return (
    <aside className="report-sheet" role="region" aria-label="Report a bug">
      <div className="report-head">
        <strong>Report a bug</strong>
        <span className="eyebrow">{route}</span>
        <button type="button" onClick={onClose} aria-label="Close the report panel">
          Close
        </button>
      </div>

      <div className="report-capture">
        {frame ? (
          <>
            <img className="report-thumb" src={frame.dataUrl} alt="The screen being reported on" />
            <div className="report-capture-actions">
              <button type="button" onClick={() => void retake()}>
                Retake
              </button>
              <button type="button" onClick={() => setFrame(null)}>
                Remove
              </button>
              <span className="eyebrow">
                {frame.width}×{frame.height}
              </span>
            </div>
          </>
        ) : (
          <div className="report-capture-actions">
            <span className="report-note">{captureNote ?? "Capturing…"}</span>
            <button type="button" onClick={() => void retake()}>
              Capture now
            </button>
          </div>
        )}
      </div>

      <p className="report-note">
        Your browser asks permission to share the screen on every capture. That prompt is expected — the
        frame is taken once and the sharing stops immediately.
      </p>

      <label className="report-field">
        <span className="eyebrow">What&rsquo;s wrong, and what you expected</span>
        <textarea
          ref={firstField}
          value={whatIsWrong}
          onChange={(e) => setWhatIsWrong(e.target.value)}
          rows={4}
          aria-label="What's wrong"
        />
      </label>

      {transcript.length > 0 ? (
        <label className="report-attach">
          <input
            type="checkbox"
            checked={attachTranscript}
            onChange={(e) => setAttachTranscript(e.target.checked)}
            aria-label="Attach the current conversation"
          />
          Attach the current conversation ({transcript.length} turns)
        </label>
      ) : null}

      {error ? (
        <p className="notice" role="status">
          {error}
        </p>
      ) : null}

      {confirmDiscard ? (
        <p className="report-confirm" role="alert">
          Discard this draft?{" "}
          <button type="button" onClick={onClose}>
            Discard
          </button>{" "}
          <button type="button" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
        </p>
      ) : null}

      <div className="report-actions">
        <button
          type="button"
          className="primary"
          onClick={save}
          // Disabled while empty, so the client can never offer an action guaranteed to fail.
          disabled={busy || !whatIsWrong.trim()}
        >
          {busy ? "Saving…" : "Save report"}
        </button>
      </div>
    </aside>
  );
}

/**
 * The current unit's conversation, published by the lesson and read by the panel.
 *
 * Deliberately a tiny module-level store rather than lifting `history` through `App`: the transcript is
 * useful to exactly one other consumer (the attach checkbox), and threading it up and back down would put a
 * lesson detail into the app shell. This is a testing tool for one person; the simplest thing that keeps the
 * two in step is the right size.
 */
let currentTranscript: { role: "user" | "assistant"; text: string }[] = [];

export function publishTranscript(next: { role: "user" | "assistant"; text: string }[]): void {
  currentTranscript = next;
}

export function readTranscript(): { role: "user" | "assistant"; text: string }[] {
  return currentTranscript;
}
