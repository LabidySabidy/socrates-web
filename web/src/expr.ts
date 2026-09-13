/**
 * expr.ts — a tiny, safe expression evaluator for interactive plots.
 *
 * `eval` is never used: a generated or authored expression must not be able to run arbitrary code.
 * This is a recursive-descent parser over a small grammar, which is also why it is easy to test.
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('-' | '+')? power
 *   power   := primary ('^' unary)?        (right associative)
 *   primary := number | ident | ident '(' args ')' | '(' expr ')'
 *
 * Identifiers resolve from the supplied scope (parameters and `x`), with `pi` and `e` as constants.
 */

export interface Compiled {
  ok: true;
  source: string;
  /** PARAMETER names the expression reads, in first-seen order. `x` is not a parameter. */
  names: string[];
  /** True when the expression reads the plot's independent variable. */
  usesX: boolean;
  evaluate(scope: Record<string, number>): number;
}

export interface CompileError {
  ok: false;
  error: string;
}

type Token = { kind: "num"; value: number } | { kind: "id"; value: string } | { kind: "op"; value: string };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenise(source: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      const value = Number(source.slice(i, j));
      if (!Number.isFinite(value)) return { error: `bad number at ${i}: ${source.slice(i, j)}` };
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) j++;
      tokens.push({ kind: "id", value: source.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    return { error: `unexpected character: ${c}` };
  }
  return tokens;
}

export function compile(source: string): Compiled | CompileError {
  const tokenised = tokenise(source);
  if (!Array.isArray(tokenised)) return { ok: false, error: tokenised.error };

  const tokens = tokenised;
  const names: string[] = [];
  let usesX = false;
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const take = (value?: string): Token | undefined => {
    const token = tokens[pos];
    if (!token) return undefined;
    if (value && !(token.kind === "op" && token.value === value)) return undefined;
    pos++;
    return token;
  };

  function parseExpr(): ((scope: Record<string, number>) => number) | { error: string } {
    let left = parseTerm();
    if ("error" in (left as object)) return left;
    for (;;) {
      const token = peek();
      if (token?.kind !== "op" || (token.value !== "+" && token.value !== "-")) break;
      pos++;
      const right = parseTerm();
      if ("error" in (right as object)) return right;
      const l = left as (s: Record<string, number>) => number;
      const r = right as (s: Record<string, number>) => number;
      const plus = token.value === "+";
      left = (scope) => (plus ? l(scope) + r(scope) : l(scope) - r(scope));
    }
    return left;
  }

  function parseTerm(): ((scope: Record<string, number>) => number) | { error: string } {
    let left = parseUnary();
    if ("error" in (left as object)) return left;
    for (;;) {
      const token = peek();
      if (token?.kind !== "op" || (token.value !== "*" && token.value !== "/")) break;
      pos++;
      const right = parseUnary();
      if ("error" in (right as object)) return right;
      const l = left as (s: Record<string, number>) => number;
      const r = right as (s: Record<string, number>) => number;
      const times = token.value === "*";
      left = (scope) => (times ? l(scope) * r(scope) : l(scope) / r(scope));
    }
    return left;
  }

  function parseUnary(): ((scope: Record<string, number>) => number) | { error: string } {
    const token = peek();
    if (token?.kind === "op" && (token.value === "-" || token.value === "+")) {
      pos++;
      const inner = parseUnary();
      if ("error" in (inner as object)) return inner;
      const f = inner as (s: Record<string, number>) => number;
      return token.value === "-" ? (scope) => -f(scope) : f;
    }
    return parsePower();
  }

  function parsePower(): ((scope: Record<string, number>) => number) | { error: string } {
    const base = parsePrimary();
    if ("error" in (base as object)) return base;
    const token = peek();
    if (token?.kind === "op" && token.value === "^") {
      pos++;
      const exponent = parseUnary(); // right associative
      if ("error" in (exponent as object)) return exponent;
      const b = base as (s: Record<string, number>) => number;
      const e = exponent as (s: Record<string, number>) => number;
      return (scope) => Math.pow(b(scope), e(scope));
    }
    return base;
  }

  function parsePrimary(): ((scope: Record<string, number>) => number) | { error: string } {
    const token = take();
    if (!token) return { error: "unexpected end of expression" };

    if (token.kind === "num") {
      const value = token.value;
      return () => value;
    }

    if (token.kind === "id") {
      if (peek()?.kind === "op" && (peek() as Token & { value: string }).value === "(") {
        pos++;
        const fn = FUNCTIONS[token.value];
        if (!fn) return { error: `unknown function: ${token.value}` };
        const args: ((s: Record<string, number>) => number)[] = [];
        if (!(peek()?.kind === "op" && (peek() as Token & { value: string }).value === ")")) {
          for (;;) {
            const arg = parseExpr();
            if ("error" in (arg as object)) return arg;
            args.push(arg as (s: Record<string, number>) => number);
            const next = peek();
            if (next?.kind === "op" && next.value === ",") {
              pos++;
              continue;
            }
            break;
          }
        }
        if (!take(")")) return { error: `expected ) after ${token.value}(` };
        return (scope) => fn(...args.map((a) => a(scope)));
      }

      const name = token.value;
      if (name in CONSTANTS) {
        const value = CONSTANTS[name];
        return () => value;
      }
      // `x` is the plot's independent variable, not a parameter the learner can drag.
      if (name === "x") {
        usesX = true;
        return (scope) => scope.x ?? Number.NaN;
      }
      if (!names.includes(name)) names.push(name);
      return (scope) => scope[name] ?? Number.NaN;
    }

    if (token.kind === "op" && token.value === "(") {
      const inner = parseExpr();
      if ("error" in (inner as object)) return inner;
      if (!take(")")) return { error: "expected )" };
      return inner;
    }

    return { error: `unexpected token: ${token.value}` };
  }

  const root = parseExpr();
  if ("error" in (root as object)) return { ok: false, error: (root as { error: string }).error };
  if (pos !== tokens.length) return { ok: false, error: `trailing input at token ${pos}` };

  const f = root as (s: Record<string, number>) => number;
  return { ok: true, source, names, usesX, evaluate: (scope) => f(scope) };
}

export interface Point {
  x: number;
  y: number;
}

/** Sample a compiled expression across a range. Non-finite results are skipped, not plotted as 0. */
export function sample(
  compiled: Compiled,
  scope: Record<string, number>,
  range: { min: number; max: number },
  steps = 120,
): Point[] {
  const points: Point[] = [];
  const span = range.max - range.min;
  if (!(span > 0) || steps < 2) return points;
  for (let i = 0; i <= steps; i++) {
    const x = range.min + (span * i) / steps;
    const y = compiled.evaluate({ ...scope, x });
    if (Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}

/** Clamp helper shared by the plot and the interactives' ranges. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
