/** TopBar — emblem, wordmark, and only what has a backing field. */
import type { ReactNode } from "react";
import { hrefHome } from "../router.ts";

export function Emblem() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="13" fill="none" stroke="rgba(32,31,29,0.25)" strokeWidth="1" />
      <path d="M2 13h22M13 2v22" stroke="rgba(32,31,29,0.18)" strokeWidth="0.75" />
      <path d="M4 16c4-8 14-8 18 0" fill="none" stroke="var(--action)" strokeWidth="1.2" />
      <circle cx="13" cy="13" r="2.4" fill="var(--ink)" />
    </svg>
  );
}

export function TopBar({
  courseCount,
  budapest,
  onBudapestChange,
  onReportBug,
  right,
}: {
  courseCount: number | null;
  /** Global, as the original header checkbox was. */
  budapest: boolean;
  onBudapestChange: (value: boolean) => void;
  /** Opens the report panel. Lives here because a defect is not per-page. */
  onReportBug: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="topbar">
      <a className="brand" href={hrefHome()}>
        <Emblem />
        SOCRATES
      </a>
      <span className="meta">
        {courseCount === null ? "loading…" : `${courseCount} course${courseCount === 1 ? "" : "s"}`}
      </span>
      <span className="spacer" />
      <label className="budapest-toggle" title="Forbid lecturing; force struggle before documentation">
        <input
          type="checkbox"
          checked={budapest}
          onChange={(e) => onBudapestChange(e.target.checked)}
          aria-label="Budapest mode"
        />
        Budapest Mode
      </label>
      {/* The capture control: GLOBAL, because a defect is not per-page. The review link sits beside it so
          the list is one click from anywhere rather than buried inside the capture panel. */}
      <a className="report-link" href="#/reports" title="Review the reports you have filed">
        Reports
      </a>
      <button
        type="button"
        className="report-trigger"
        onClick={() => onReportBug()}
        title="Capture what you are looking at and describe what is wrong"
      >
        Report a bug
      </button>
      {right}
    </header>
  );
}
