/**
 * EditableTitle — the course name, edited in place.
 *
 * The name lives in exactly ONE place, the H1 of MISSION.md, and the server derives the rest (slug,
 * directory, URL, catalogue). So this component does not hold a name: it sends an edit and reports what
 * the server decided. Enter commits, Escape cancels, and a refusal keeps the old name on screen while
 * saying why — a name that silently reverts is worse than one that explains itself.
 */
import { useEffect, useRef, useState } from "react";
import { renameCourse } from "../api.ts";

export function EditableTitle({
  courseId,
  title,
  className = "",
  as: Tag = "h1",
  onRenamed,
}: {
  courseId: string;
  title: string;
  className?: string;
  as?: "h1" | "h2" | "span";
  /** Fired with the new id after the server has written and reconciled (or accepted a deferral). */
  onRenamed?: (from: string, to: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // A rename that lands from elsewhere (the tutor's title, another tab) updates the display.
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function cancel() {
    setEditing(false);
    setDraft(title);
    setError(null);
  }

  function commit() {
    const clean = draft.trim();
    if (busy) return;
    if (!clean) {
      setError("a title is required");
      return;
    }
    if (clean === title) {
      cancel();
      return;
    }
    setBusy(true);
    setError(null);
    void renameCourse(courseId, clean).then((res) => {
      setBusy(false);
      if (!res.ok) {
        // The old name stays on screen, and the reason is stated rather than swallowed.
        setError(res.error);
        return;
      }
      setEditing(false);
      if (res.id !== courseId) onRenamed?.(courseId, res.id);
    });
  }

  if (!editing) {
    return (
      <Tag
        className={`editable-title ${className}`}
        role="button"
        tabIndex={0}
        title="Rename this course"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {title}
      </Tag>
    );
  }

  return (
    <span className={`title-editor ${className}`}>
      <input
        ref={inputRef}
        className="title-input"
        value={draft}
        aria-label="Course title"
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        // Blur commits rather than cancels: the common gesture after typing a name is to click away.
        onBlur={() => {
          if (draft.trim() && draft.trim() !== title) commit();
          else cancel();
        }}
      />
      {error ? (
        <span className="notice title-error" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}
