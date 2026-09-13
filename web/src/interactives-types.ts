/**
 * interactives-types.ts — the client's view of an interactive spec.
 *
 * Mirrors `interactives.ts` on the server, which validates before serving. The client re-validates
 * only that the formula parses (it must draw something), using the same `expr.ts` evaluator the
 * server used — one implementation of "what does this formula mean".
 */

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

export interface InteractivesResponse {
  unit: number;
  source: "authored" | "generated" | "cache" | "none";
  interactives: Interactive[];
  generatedAt?: string;
  rejected?: string[];
  warnings: string[];
  error?: string;
  detail?: string;
  excerpt?: string;
}
