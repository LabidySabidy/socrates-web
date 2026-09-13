/**
 * module-types.ts — the module taxonomy: one icon glyph and one label per type.
 *
 * Kept out of the .tsx component so the vocabulary can be tested without a browser. Mirrors the
 * server's `MODULE_TYPES` in course-model.ts; adding a type in one place and not the other is a
 * TypeScript error on this side because both records are exhaustive over `ModuleType`.
 *
 * Vocabulary is deliberately complete even where a SCREEN is deferred: FAQ and primary-source
 * modules render as rows with the right icon and label today, while their dedicated screens stay
 * out of scope.
 */
import type { ModuleType } from "./types.ts";

/** Lucide-style 24-viewBox glyphs at 1.5 stroke. */
export const MODULE_PATHS: Record<ModuleType, string> = {
  // derived
  recite: "M12 3v18M5 7h14M7 7l-3 6h6zM17 7l-3 6h6z",
  explain: "M21 12a8 8 0 01-8 8H7l-4 2 1.5-4A8 8 0 1121 12zM9 11h6M9 14h4",
  review: "M2 12a10 10 0 1010-10M2 12l3-3M2 12l3 3M12 8v4l3 2",
  misconceptions: "M12 9v4M12 16h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  // authored
  article: "M4 5h16M4 10h16M4 15h10M4 20h7",
  video: "M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM16 10l5-3v10l-5-3",
  practice: "M9 11l2 2 4-4M12 3l9 4v6c0 4-3.5 7-9 8-5.5-1-9-4-9-8V7z",
  quiz: "M9 9a3 3 0 116 0c0 2-3 2-3 4M12 17h.01M4 4h16v16H4z",
  test: "M8 4h8v3a4 4 0 11-8 0zM6 8h3M15 8h3M5 20h14l-1-9H6z",
  "course-challenge": "M8 21V4M8 4h11l-2 4 2 4H8",
  "primary-source": "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5",
  faq: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.1 9a3 3 0 115.8 1c0 2-3 2-3 4M12 17h.01",
  interact: "M4 20l7-7M8 4l12 12-4 2-2 4z",
  game: "M6 12h4M8 10v4M15 12h.01M18 12h.01M7 7h10a5 5 0 010 10H7A5 5 0 017 7z",
  project: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
  "ai-activity": "M3 12h4l2-7 3 14 2-7h7",
};

export const MODULE_LABELS: Record<ModuleType, string> = {
  recite: "Recite",
  explain: "Explain",
  review: "Review",
  misconceptions: "Misconceptions",
  article: "Article",
  video: "Video",
  practice: "Practice",
  quiz: "Quiz",
  test: "Unit test",
  "course-challenge": "Course challenge",
  "primary-source": "Primary source",
  faq: "FAQ",
  interact: "Interact",
  game: "Game",
  project: "Project",
  "ai-activity": "AI activity",
};

export const ALL_MODULE_TYPES = Object.keys(MODULE_LABELS) as ModuleType[];

export function moduleTypeLabel(type: ModuleType): string {
  return MODULE_LABELS[type] ?? type;
}
