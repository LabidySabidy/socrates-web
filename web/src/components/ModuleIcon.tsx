/**
 * ModuleIcon — one line glyph per module type. Icon + label together carry the type, so the icon
 * is decorative (aria-hidden). The vocabulary lives in `module-types.ts`.
 */
import type { ModuleType } from "../types.ts";
import { MODULE_PATHS } from "../module-types.ts";

export { moduleTypeLabel } from "../module-types.ts";

export function ModuleIcon({ type, size = 19 }: { type: ModuleType; size?: number }) {
  return (
    <span className="icon" aria-hidden="true">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={MODULE_PATHS[type] ?? MODULE_PATHS.article} />
      </svg>
    </span>
  );
}
