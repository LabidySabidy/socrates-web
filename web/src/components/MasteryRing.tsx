/**
 * MasteryRing — the one mastery affordance. Colour is a stroke, never a fill.
 * Every ring is labelled for assistive tech; it is a data graphic, not decoration.
 */
import type { Mastery } from "../types.ts";

export function MasteryRing({
  mastery,
  size = 26,
  stroke = 2.5,
  label,
}: {
  mastery: Mastery;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * mastery.ring;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `${mastery.state} mastery`}
      style={{ flex: "none" }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(32,31,29,0.12)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={mastery.color}
        strokeWidth={stroke}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** The five-state legend, used in the rail footer. */
export function MasteryLegend({ states }: { states: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {states.map((s) => (
        <span className="item" key={s.label}>
          <span className="dot" style={{ border: `1.5px solid ${s.color}` }} aria-hidden="true" />
          {s.label}
        </span>
      ))}
    </div>
  );
}
