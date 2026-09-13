/**
 * ManageCourses — register a course by directory, and hide / unhide / unregister.
 *
 * Unregister edits the registry only; a course that also lives under the scan root reappears, so
 * the server answers with `stillDiscovered` and we say so instead of appearing to do nothing.
 */
import { useState } from "react";
import { postCourse } from "../api.ts";
import type { CourseRef } from "../types.ts";

export interface ManageResult {
  kind: "ok" | "error";
  message: string;
}

export function ManageCourses({
  courses,
  onChanged,
}: {
  courses: CourseRef[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManageResult | null>(null);

  async function send(body: Parameters<typeof postCourse>[0], okMessage: string) {
    setBusy(true);
    setResult(null);
    try {
      const res = await postCourse(body);
      if (!res.ok) {
        setResult({ kind: "error", message: res.error ?? "request rejected" });
        return;
      }
      setResult({
        kind: "ok",
        message: res.stillDiscovered ? `${okMessage} — ${res.hint ?? "still visible"}` : okMessage,
      });
      setDir("");
      setLabel("");
      onChanged();
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="manage" aria-label="Manage courses">
      <div className="manage-head">
        <h2 className="eyebrow">Courses</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Done" : "Add or manage"}
        </button>
      </div>

      {open ? (
        <div className="manage-body">
          <form
            className="add-form"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = dir.trim();
              if (!trimmed) return;
              void send(
                { dir: trimmed, label: label.trim() || undefined },
                "Registered",
              );
            }}
          >
            <label>
              <span className="eyebrow">Directory</span>
              <input
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                placeholder="F:/Development/SomeProject"
                aria-label="Course directory"
              />
            </label>
            <label>
              <span className="eyebrow">Label (optional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Shown instead of the mission destination"
                aria-label="Course label"
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              Add course
            </button>
          </form>

          <ul className="manage-list">
            {courses.map((c) => (
              <li key={c.id}>
                <span className="manage-name">{c.label}</span>
                <span className="manage-src eyebrow">
                  {c.fromRegistry ? "registry" : "scan"}
                  {c.fromRegistry && c.fromScan ? " + scan" : ""}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      { dir: c.dir, action: c.hidden ? "unhide" : "hide" },
                      c.hidden ? "Unhidden" : "Hidden",
                    )
                  }
                >
                  {c.hidden ? "Unhide" : "Hide"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ dir: c.dir, action: "unregister" }, "Unregistered")}
                >
                  Unregister
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <p className={result.kind === "ok" ? "manage-ok" : "notice"} role="status">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
