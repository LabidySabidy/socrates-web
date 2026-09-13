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

export function TopBar({ courseCount, right }: { courseCount: number | null; right?: ReactNode }) {
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
      {right}
    </header>
  );
}
