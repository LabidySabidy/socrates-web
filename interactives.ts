/**
 * interactives.ts — interactive and game specs: authored in COURSE.md, or generated and VALIDATED.
 *
 * Same rule as assessments: nothing is served unless it validates, and an authored spec passes the
 * same gate as a generated one. A generated spec is only accepted when its expression actually
 * parses and its parameters are coherent, so a learner never gets a plot that cannot draw.
 *
 * The expression evaluator is imported from the client (`web/src/expr.ts`) rather than copied.
 * There is one implementation of "what does this formula mean" and both sides use it — a second
 * copy could disagree with the thing the learner sees.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "./web/src/expr.ts";

export interface SliderParam {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface SliderSpec {
  kind: "slider";
  fn: string;
  params: SliderParam[];
  xRange: [number, number];
  caption?: string;
}

export interface TargetWindowSpec {
  kind: "target-window";
  speed: number;
  band: [number, number];
  caption?: string;
}

export type Spec = SliderSpec | TargetWindowSpec;

export interface Interactive {
  id: string;
  title: string;
  unit: number;
  source: "authored" | "generated" | "cache";
  spec: Spec;
}

export type SpecResult = { ok: true; spec: Spec } | { ok: false; error: string };

export const WARN = {
  badKind: (k: string) => `unsupported-interactive-kind:${k}`,
  badFn: (reason: string) => `expression-invalid:${reason}`,
  noParams: "slider-has-no-parameters",
  badParam: (name: string, reason: string) => `parameter-invalid:${name}:${reason}`,
  noXRange: "slider-missing-x-range",
  badSpeed: "game-speed-must-be-positive",
  badBand: "game-band-must-be-two-increasing-numbers",
} as const;

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function validateSpec(raw: unknown, ctx: { id: string }): SpecResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "spec is not an object" };
  const r = raw as Record<string, unknown>;
  const caption = typeof r.caption === "string" && r.caption.trim() ? r.caption.trim() : undefined;
  const kind = typeof r.kind === "string" ? r.kind : "";

  if (kind === "slider") {
    const fn = typeof r.fn === "string" ? r.fn.trim() : "";
    if (!fn) return { ok: false, error: WARN.badFn("empty") };
    const compiled = compile(fn);
    if (!compiled.ok) return { ok: false, error: WARN.badFn(compiled.error) };

    const rawParams = Array.isArray(r.params) ? r.params : [];
    if (rawParams.length === 0) return { ok: false, error: WARN.noParams };
    const params: SliderParam[] = [];
    for (const entry of rawParams) {
      const p = entry as Record<string, unknown>;
      const name = typeof p.name === "string" ? p.name.trim() : "";
      if (!IDENT.test(name)) return { ok: false, error: WARN.badParam(name || "?", "not an identifier") };
      const min = num(p.min);
      const max = num(p.max);
      const step = num(p.step);
      const value = num(p.value);
      if (min === null || max === null) return { ok: false, error: WARN.badParam(name, "min and max must be numbers") };
      if (!(min < max)) return { ok: false, error: WARN.badParam(name, "min must be less than max") };
      if (step === null || step <= 0) return { ok: false, error: WARN.badParam(name, "step must be positive") };
      if (value === null) return { ok: false, error: WARN.badParam(name, "value must be a number") };
      params.push({ name, min, max, step, value: Math.min(Math.max(value, min), max) });
    }
    // The expression must read something it can be given, or the plot is a flat line and the
    // sliders do nothing.
    if (!compiled.usesX && compiled.names.length === 0) {
      return { ok: false, error: WARN.badFn("reads neither x nor a parameter") };
    }

    const xr = Array.isArray(r.xRange) ? r.xRange : null;
    const xMin = xr ? num(xr[0]) : null;
    const xMax = xr ? num(xr[1]) : null;
    if (xMin === null || xMax === null || !(xMin < xMax)) return { ok: false, error: WARN.noXRange };

    return { ok: true, spec: { kind: "slider", fn, params, xRange: [xMin, xMax], caption } };
  }

  if (kind === "target-window") {
    const speed = num(r.speed);
    if (speed === null || speed <= 0) return { ok: false, error: WARN.badSpeed };
    const band = Array.isArray(r.band) ? r.band : null;
    const low = band ? num(band[0]) : null;
    const high = band ? num(band[1]) : null;
    if (low === null || high === null || !(low < high) || low < 0 || high > 100) {
      return { ok: false, error: WARN.badBand };
    }
    return {
      ok: true,
      spec: {
        kind: "target-window",
        speed: Math.min(Math.max(speed, 0.05), 5),
        band: [low, high],
        caption,
      },
    };
  }

  return { ok: false, error: WARN.badKind(kind || "(none)") };
}

export function validateSpecs(
  raw: unknown,
  ctx: { prefix?: string } = {},
): { specs: Spec[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const specs: Spec[] = [];
  const errors: string[] = [];
  list.forEach((entry, i) => {
    const result = validateSpec(entry, { id: `${ctx.prefix ?? "i"}${i + 1}` });
    if (result.ok) specs.push(result.spec);
    else errors.push(`${ctx.prefix ?? "i"}${i + 1}: ${result.error}`);
  });
  return { specs, errors };
}

// ---------------------------------------------------------------------------
// Extraction and the generation contract
// ---------------------------------------------------------------------------

/** Same contract as assessments: a fenced json block or a tag, never a bare array in prose. */
export function extractSpecs(text: string): { raw?: unknown; error?: string } {
  const tagged = /<interactives>([\s\S]*?)<\/interactives>/i.exec(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = tagged?.[1] ?? fenced?.[1];
  if (!body) return { error: "reply contained no JSON block (expected ```json or <interactives>)" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch (err) {
    return { error: `reply JSON did not parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (Array.isArray(parsed)) return { raw: parsed };
  const items = (parsed as { interactives?: unknown } | null)?.interactives;
  if (Array.isArray(items)) return { raw: items };
  return { error: "reply JSON had no interactives array" };
}

export function buildGenerationPrompt(input: {
  courseTitle: string;
  unitTitle: string;
  concepts: string[];
}): string {
  return [
    `Design ONE interactive for a learner studying "${input.unitTitle}" in the course "${input.courseTitle}".`,
    `Concepts in scope: ${input.concepts.join(", ") || "(none recorded)"}`,
    ``,
    `Reply with ONE fenced json block and nothing else:`,
    "```json",
    `{ "interactives": [ { "kind": "slider", "fn": "m * x + b", "xRange": [-6, 6], "params": [ { "name": "m", "min": -4, "max": 4, "step": 0.5, "value": 1 } ], "caption": "..." } ] }`,
    "```",
    ``,
    `Rules:`,
    `- "kind" is "slider" (a function plot with draggable parameters) or "target-window" (a timing game).`,
    `- For a slider, "fn" is a formula in "x" and the declared parameter names only. Allowed: numbers, + - * / ^, parentheses, and the functions sin cos tan sqrt abs exp log pow min max round floor ceil, plus the constants pi and e. Nothing else parses.`,
    `- Every parameter needs "name", "min", "max", "step", "value", with min < max and a positive step.`,
    `- For a target-window game give "speed" (0.05-5) and "band" as two increasing numbers within 0-100.`,
    `- "caption" is one short instruction to the learner.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export function interactivesDir(courseDir: string): string {
  return join(courseDir, ".agent", "learning", "INTERACTIVES");
}

export function cachePath(courseDir: string, unit: number): string {
  return join(interactivesDir(courseDir), `unit-${unit}.json`);
}

export function readCache(
  courseDir: string,
  unit: number,
): { interactives: Interactive[]; generatedAt: string } | null {
  const path = cachePath(courseDir, unit);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { interactives?: unknown; generatedAt?: unknown };
    if (!Array.isArray(parsed.interactives)) return null;
    return {
      interactives: parsed.interactives as Interactive[],
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeCache(
  courseDir: string,
  unit: number,
  interactives: Interactive[],
  generatedAt: string,
): void {
  mkdirSync(interactivesDir(courseDir), { recursive: true });
  writeFileSync(
    cachePath(courseDir, unit),
    JSON.stringify({ version: 1, unit, generatedAt, interactives }, null, 2) + "\n",
    "utf8",
  );
}
