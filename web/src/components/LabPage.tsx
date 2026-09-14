/**
 * LabPage — interactives and games.
 *
 * Tabs across the unit's interactives, each with its own frame loop. Loops are cancelled on unmount
 * and when the tab changes: a shared handle across two loops is how you end up with two animations
 * fighting over one canvas.
 *
 * Reduced motion is respected for everything decorative. The launch game's marker keeps moving
 * because that motion IS the interaction — the design reference makes the same distinction
 * ("suppressed under reduced motion (direct interaction is preserved)").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { humanize } from "../humanize.ts";
import { humanMessage, materialFailureView } from "../course-error.ts";
import { fetchCourse, fetchInteractives, generateInteractives } from "../api.ts";
import type { Interactive, InteractivesResponse, SliderSpec, TargetWindowSpec } from "../interactives-types.ts";
import type { CourseTree, Unit } from "../types.ts";
import { hrefCourse, hrefHome } from "../router.ts";
import { compile, sample } from "../expr.ts";
import {
  accuracy,
  bandFraction,
  CLEAR_AFTER_SECONDS,
  initGame,
  launch,
  tick,
  type GameState,
} from "../game.ts";

/** True when the reader has asked for reduced motion. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Slider interactive
// ---------------------------------------------------------------------------

const WIDTH = 420;
const HEIGHT = 300;

export function SliderInteractive({ spec }: { spec: SliderSpec }) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(spec.params.map((p) => [p.name, p.value])),
  );
  const compiled = useMemo(() => compile(spec.fn), [spec.fn]);

  const [xMin, xMax] = spec.xRange;
  const points = useMemo(
    () => (compiled.ok ? sample(compiled, values, { min: xMin, max: xMax }, 160) : []),
    [compiled, values, xMin, xMax],
  );

  // A fixed y-window keeps dragging a parameter from making the curve jump scale.
  const ySpan = Math.max(Math.abs(xMax - xMin), 1) * 0.75;
  const toX = (x: number) => ((x - xMin) / (xMax - xMin)) * WIDTH;
  const toY = (y: number) => HEIGHT / 2 - (y / ySpan) * (HEIGHT / 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`).join(" ");

  if (!compiled.ok) {
    return <p className="notice">This interactive's formula does not parse: {compiled.error}</p>;
  }

  return (
    <div className="interactive">
      {spec.caption ? <p className="reading interactive-caption">{spec.caption}</p> : null}
      <svg
        className="plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Plot of ${spec.fn}`}
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="var(--surface)" />
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`v${i}`} x1={(i * WIDTH) / 12} y1={0} x2={(i * WIDTH) / 12} y2={HEIGHT} stroke="rgba(32,31,29,0.07)" />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(i * HEIGHT) / 8} x2={WIDTH} y2={(i * HEIGHT) / 8} stroke="rgba(32,31,29,0.07)" />
        ))}
        <line x1={0} y1={toY(0)} x2={WIDTH} y2={toY(0)} stroke="rgba(32,31,29,0.25)" />
        <line x1={toX(0)} y1={0} x2={toX(0)} y2={HEIGHT} stroke="rgba(32,31,29,0.25)" />
        <path d={path} fill="none" stroke="var(--action)" strokeWidth="2" />
      </svg>

      <div className="params">
        {spec.params.map((param) => (
          <label key={param.name} className="param">
            <span className="eyebrow">
              {param.name} = <span className="num">{values[param.name]}</span>
            </span>
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={values[param.name]}
              aria-label={param.name}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [param.name]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target-window game
// ---------------------------------------------------------------------------

export function TargetWindowGame({ spec }: { spec: TargetWindowSpec }) {
  const [state, setState] = useState<GameState>(() => initGame());
  const frame = useRef<number | null>(null);
  const last = useRef<number>(0);

  useEffect(() => {
    const step = (now: number) => {
      const dt = last.current ? Math.min((now - last.current) / 1000, 0.1) : 0;
      last.current = now;
      setState((prev) => tick(prev, dt, spec));
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      last.current = 0;
    };
  }, [spec]);

  const band = bandFraction(spec.band);
  const hit = accuracy(state);

  return (
    <div className="interactive">
      {spec.caption ? <p className="reading interactive-caption">{spec.caption}</p> : null}

      <div className="launch-bar" role="img" aria-label={`Marker at ${Math.round(state.marker)} percent`}>
        <span
          className="band"
          style={{ left: `${band.start * 100}%`, width: `${band.width * 100}%` }}
          aria-hidden="true"
        />
        <span className="marker" style={{ left: `${state.marker}%` }} aria-hidden="true" />
      </div>

      <div className="launch-row">
        <button type="button" className="primary" onClick={() => setState((s) => launch(s, spec))}>
          Launch
        </button>
        <span className="num marker-readout" aria-live="off">
          marker {Math.round(state.marker)} · band {spec.band[0]}–{spec.band[1]}
        </span>
      </div>

      <p className={`reading launch-message ${state.outcome ?? ""}`} role="status">
        {state.message ||
          `Shots ${state.shots} · hits ${state.hits}${hit === null ? "" : ` · accuracy ${Math.round(hit * 100)}%`}`}
      </p>
      {state.phase === "resolved" ? (
        <p className="eyebrow">clearing in {Math.max(0, CLEAR_AFTER_SECONDS - state.sinceOutcome).toFixed(1)}s</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LabPage({
  courseId,
  unitNumber,
  onExit,
}: {
  courseId: string;
  unitNumber: number;
  onExit: () => void;
}) {
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [data, setData] = useState<InteractivesResponse | null>(null);
  const [tab, setTab] = useState(0);
  /** B2a — who to blame and whether a retry is worth offering. */
  const [material, setMaterialError] = useState<ReturnType<typeof materialFailureView> | null>(null);
  const [generating, setGenerating] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    let alive = true;
    Promise.all([fetchCourse(courseId), fetchInteractives(courseId, unitNumber)])
      .then(([t, i]) => {
        if (!alive) return;
        setTree(t);
        setData(i);
        setTab(0);
      })
      .catch((err: unknown) => {
        if (alive) {
          // B2a — the same catch covers both fetches, so it cannot assume the material is what failed.
          const view = materialFailureView(err, "interactive");
          setMaterialError(view);
          setData({
            unit: unitNumber,
            source: "none",
            interactives: [],
            warnings: [],
            error: view.heading,
            detail: view.detail,
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [courseId, unitNumber]);

  const unit: Unit | null = tree?.units.find((u) => u.n === unitNumber) ?? null;
  const list: Interactive[] = data?.interactives ?? [];
  const current = list[tab];

  async function generate() {
    setGenerating(true);
    const result = await generateInteractives(courseId, unitNumber);
    setGenerating(false);
    setData(result);
    setTab(0);
  }

  const bar = (
    <nav className="lesson-bar" aria-label="Lab">
      <span className="crumbs">
        <a href={hrefCourse(courseId, unitNumber)} onClick={onExit}>
          {tree?.title ?? courseId}
        </a>
        <span aria-hidden="true"> › </span>
        <span>Unit {unitNumber}</span>
        {unit ? (
          <>
            <span aria-hidden="true"> › </span>
            <span aria-current="page">{humanize(unit.title)}</span>
          </>
        ) : null}
      </span>
      <span className="lesson-bar-right">
        {data && data.interactives.length > 0 ? (
          <span className="eyebrow quiz-source">{data.source}</span>
        ) : null}
        <button type="button" onClick={onExit}>
          Exit Lesson
        </button>
      </span>
    </nav>
  );

  if (data?.error) {
    return (
      <div className="lesson">
        {bar}
        <main className="page">
          {/* B2a — classified, so a course that cannot be read is not reported as a lab problem. */}
          <h1 className="display greeting">
            {material?.heading ?? "This interactive could not be prepared"}
          </h1>
          <p className="greeting-sub reading">{humanMessage(data.detail ?? data.error)}</p>
          {/* A SUMMARY of what arrived, never the model's text: when it has produced items that text IS
              the answer key. A `p`, not a `pre` — this is a sentence, not a code sample. */}
          {data.excerpt ? <p className="notice excerpt-summary">{data.excerpt}</p> : null}
          <div className="quiz-actions">
            {/* Only when regenerating could help — a course that cannot be read is not fixed by retrying. */}
            {material?.retryable !== false ? (
              <button type="button" className="primary" onClick={() => void generate()} disabled={generating}>
                {generating ? "Generating…" : "Try generating again"}
              </button>
            ) : null}
            <a className="primary" href={hrefHome()}>
              ← Back to the library
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="lesson">
        {bar}
        <main className="page">
          <h1 className="display greeting">No interactive yet</h1>
          <p className="greeting-sub reading">
            This unit has no authored interactive. The tutor can design one for{" "}
            {unit ? `“${humanize(unit.title)}”` : "this unit"}.
          </p>
          <div className="quiz-actions">
            <button type="button" className="primary" onClick={() => void generate()} disabled={generating}>
              {generating ? "Generating…" : "Generate an interactive"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="lesson">
      {bar}
      <div className="lesson-scroll">
        <div className="lab">
          <div className="tabs" role="tablist" aria-label="Interactives">
            {list.map((item, i) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={i === tab}
                className={i === tab ? "tab active" : "tab"}
                onClick={() => setTab(i)}
              >
                {item.spec.kind === "slider" ? "Interactive" : "Game"} · {item.title}
              </button>
            ))}
          </div>

          <h1 className="display lab-title">
            {current.spec.kind === "slider" ? "Function plot" : "Launch window"}
          </h1>

          {reduced ? (
            <p className="eyebrow lab-motion-note">
              Reduced motion is on: decorative animation is off. The game&rsquo;s marker still moves —
              that motion is the interaction.
            </p>
          ) : null}

          {current.spec.kind === "slider" ? (
            <SliderInteractive spec={current.spec} />
          ) : (
            <TargetWindowGame spec={current.spec} />
          )}

          <p className="eyebrow provenance">
            {data?.source === "authored" ? "authored" : data?.source === "generated" ? "generated" : "cached"} ·{" "}
            {current.id}
          </p>
        </div>
      </div>
    </div>
  );
}
