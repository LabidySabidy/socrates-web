/**
 * ModuleIcon — Lucide-style 24-viewBox line glyphs at 1.5 stroke, one per module type.
 * Icon + label together carry the type, so the icon is decorative (aria-hidden).
 */
import type { ModuleType } from "../types.ts";

const PATHS: Record<ModuleType, string> = {
  article: "M4 5h16M4 10h16M4 15h10M4 20h7",
  video: "M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM16 10l5-3v10l-5-3",
  practice: "M9 11l2 2 4-4M12 3l9 4v6c0 4-3.5 7-9 8-5.5-1-9-4-9-8V7z",
  quiz: "M9 9a3 3 0 116 0c0 2-3 2-3 4M12 17h.01M4 4h16v16H4z",
  test: "M8 4h8v3a4 4 0 11-8 0zM6 8h3M15 8h3M5 20h14l-1-9H6z",
  recite: "M12 3v18M5 7h14M7 7l-3 6h6zM17 7l-3 6h6z",
  explain: "M21 12a8 8 0 01-8 8H7l-4 2 1.5-4A8 8 0 1121 12zM9 11h6M9 14h4",
  review: "M2 12a10 10 0 1010-10M2 12l3-3M2 12l3 3M12 8v4l3 2",
  misconceptions: "M12 9v4M12 16h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  interact: "M4 20l7-7M8 4l12 12-4 2-2 4z",
  game: "M6 12h4M8 10v4M15 12h.01M18 12h.01M7 7h10a5 5 0 010 10H7A5 5 0 017 7z",
  project: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
};

const LABELS: Record<ModuleType, string> = {
  article: "Article",
  video: "Video",
  practice: "Practice",
  quiz: "Quiz",
  test: "Unit test",
  recite: "Recite",
  explain: "Explain",
  review: "Review",
  misconceptions: "Misconceptions",
  interact: "Interact",
  game: "Game",
  project: "Project",
};

export function moduleTypeLabel(type: ModuleType): string {
  return LABELS[type] ?? type;
}

export function ModuleIcon({ type, size = 19 }: { type: ModuleType; size?: number }) {
  return (
    <span className="icon" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[type] ?? PATHS.article} />
      </svg>
    </span>
  );
}
