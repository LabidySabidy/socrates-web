/**
 * ManageCourses — register a course by directory, and hide / unhide / unregister.
 *
 * The scan root is shown here so the catalogue count is always explainable: "9 courses" is only
 * meaningful next to "scanning F:/Development".
 *
 * Unregister edits the registry only; a course that also lives under the scan root reappears, so
 * the server answers with `stillDiscovered` and we say so instead of appearing to do nothing.
 */
import { useState } from "react";
import { postCourse } from "../api.ts";
import type { CourseRef } from "../types.ts";
import { uninitiatedCourses } from "../select.ts";

export interface ManageResult {
  kind: "ok" | "error";
  message: string;
}

export function ManageCourses({
  courses,
  root,
  onChanged,
}: {
  courses: CourseRef[];
  root: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManageResult | null>(null);

  const uninitiated = uninitiatedCourses(courses);

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

      <p className="manage-root eyebrow" data-testid="scan-root">
        Scanning {root ?? "(no scan root configured)"}
      </p>

      {open ? (
        <div className="manage-body">
          <form
            className="add-form"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = dir.trim();
              if (!trimmed) return;
              void send({ dir: trimmed, label: label.trim() || undefined }, "Registered");
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

          {uninitiated.length > 0 ? (
            <>
              <h3 className="eyebrow manage-sub">
                Not initiated (no MISSION.md) · {uninitiated.length}
              </h3>
              <p className="manage-hint">
                These directories have a learning folder but no mission, so they are not courses and
                do not appear in the catalogue or its count. A mission is what marks a course as
                started.
              </p>
              <ul className="manage-list">
                {uninitiated.map((c) => (
                  <li key={c.id}>
                    <span className="manage-name">{c.id}</span>
                    <span className="manage-src eyebrow">not initiated (no MISSION.md)</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
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
