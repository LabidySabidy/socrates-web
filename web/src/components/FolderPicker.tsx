/**
 * FolderPicker — choose a course directory instead of typing its path.
 *
 * Browsers cannot give this app an absolute path: the File System Access API withholds it by design
 * and `<input webkitdirectory>` only uploads files. So the browsing happens on the SERVER, which
 * returns directory names and paths. This component is the window onto that.
 *
 * Courses are flagged and sorted first, because choosing one is the point.
 */
import { useCallback, useEffect, useState } from "react";
import { browseDirs } from "../api.ts";
import type { BrowseResult } from "../types.ts";

export function FolderPicker({
  start,
  onPick,
  onClose,
}: {
  /** Where to open. Falls back to the drive roots if it is not a directory. */
  start: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** A path can be typed or pasted, so a deep tree is one step rather than ten clicks. */
  const [typed, setTyped] = useState(start ?? "");

  const load = useCallback(
    async (path: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const next = await browseDirs(path);
        setView(next);
        setTyped(next.path ?? "");
      } catch (err) {
        // The start path may not exist; the roots are always answerable.
        if (path !== null) {
          try {
            setView(await browseDirs(null));
            setError(`${err instanceof Error ? err.message : String(err)} — showing drives instead`);
            return;
          } catch {
            /* fall through */
          }
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(start);
  }, [load, start]);

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Choose a course folder">
      <div className="picker">
        <header className="picker-head">
          <span className="eyebrow">Choose a course folder</span>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <form
          className="picker-path-row"
          onSubmit={(e) => {
            e.preventDefault();
            void load(typed.trim() || null);
          }}
        >
          <input
            className="picker-path num"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Paste a path, or pick a drive below"
            aria-label="Folder path"
            spellCheck={false}
          />
          <button type="submit" disabled={loading}>
            Go
          </button>
        </form>

        <div className="picker-list" role="list">
          {view?.parent ? (
            <button type="button" className="picker-row picker-up" role="listitem" onClick={() => void load(view.parent)}>
              <span className="picker-icon" aria-hidden="true">↰</span> ..
            </button>
          ) : null}

          {view?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="picker-row"
              role="listitem"
              onClick={() => void load(entry.path)}
              title={entry.path}
            >
              <span className="picker-icon" aria-hidden="true">▸</span>
              <span className="picker-name">{entry.name}</span>
              {entry.initiated ? (
                <span className="picker-badge course">course</span>
              ) : entry.isCourse ? (
                <span className="picker-badge bare">not started</span>
              ) : null}
            </button>
          ))}

          {view && view.entries.length === 0 && !view.parent ? null : null}
          {view && view.entries.length === 0 ? <p className="picker-empty">No sub-folders here.</p> : null}
          {loading ? <p className="picker-empty">Loading…</p> : null}
        </div>

        {error ? <p className="notice picker-error">{error}</p> : null}

        <footer className="picker-foot">
          {view?.path ? (
            <span className="eyebrow picker-hint">
              Open a folder to look inside it, then use the folder you are in.
            </span>
          ) : (
            <span className="eyebrow picker-hint">Pick a drive to start.</span>
          )}
          <button
            type="button"
            className="primary"
            disabled={!view?.path}
            onClick={() => view?.path && onPick(view.path)}
          >
            Use this folder
          </button>
        </footer>
      </div>
    </div>
  );
}
