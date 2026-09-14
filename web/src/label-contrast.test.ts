/**
 * F1a — the small uppercase label treatment must be readable.
 *
 * `--ink-45` (rgba(32,31,29,0.45)) composited to ~2.8:1 against the page background, well under the WCAG AA
 * 4.5:1 floor for small text, at 9.5–10.5px. The audit named four selectors; there are SIX using the
 * identical treatment, and one of them (`.unit .unit-n`) sits on a tinted background that makes it 1.8:1.
 *
 * This test asserts the tokens and sizes at the SOURCE, because there is no DOM here (see web/package.json —
 * React only). The composited-ratio measurement is done in the browser and pasted in the report; what is
 * pinned here is that no label rule can regress to a small size or the 45%-alpha ink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

/**
 * The rule body for a selector — EVERY line of it.
 *
 * `.eyebrow` is multi-line while the others are single-line, and a one-line helper silently read half of
 * it, which made assertions fail for the wrong reason.
 */
function rule(selector: string): string {
  const lines = css.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(`${selector} {`));
  assert.ok(start >= 0, `no rule found for ${selector}`);
  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    body.push(lines[i]);
    if (lines[i].includes("}")) break;
  }
  return body.join("\n");
}

const LABEL_SELECTORS = [
  ".eyebrow",
  ".unit .unit-n",
  ".mod .mod-type",
  ".telemetry h2",
  ".sm2-table th",
  ".journal h2",
];

test("the label treatment is at the practical size floor", () => {
  for (const sel of LABEL_SELECTORS) {
    const body = rule(sel);
    const size = Number(/font-size:\s*([\d.]+)px/.exec(body)?.[1]);
    assert.ok(size, `${sel}: expected a px font-size in ${body.trim()}`);
    assert.ok(size >= 12, `${sel} is ${size}px — uppercase letter-spaced text needs at least 12px`);
  }
});

test("no label rule uses the low-alpha ink that measured 2.8:1", () => {
  for (const sel of LABEL_SELECTORS) {
    const body = rule(sel);
    assert.ok(
      !/var\(--ink-45\)/.test(body),
      `${sel} still uses --ink-45 (2.8:1 composited, or 1.8:1 on a tint) — use a darker token`,
    );
  }
});

test("the darker ink the labels use is itself strong enough", () => {
  // Whatever they were changed to must be a token that can pass: 55% alpha or an explicit darker ink.
  const used = LABEL_SELECTORS.map((s) => /color:\s*var\(--([a-z0-9-]+)\)/.exec(rule(s))?.[1]).filter(Boolean);
  assert.ok(used.length === LABEL_SELECTORS.length, `every label must name a colour token, got ${used.join(", ")}`);
  for (const token of new Set(used)) {
    const declared = new RegExp(String.raw`--${token}:\s*rgba?\(([^)]+)\)`).exec(css);
    assert.ok(declared, `--${token} is not declared as an rgb/rgba value`);
    const parts = declared![1].split(",").map((p) => Number(p.trim()));
    const alpha = parts.length === 4 ? parts[3] : 1;
    assert.ok(alpha >= 0.55, `--${token} has alpha ${alpha}, too light for a 12px+ label`);
  }
});

test("the labels are still visually distinct from body text — the fix must not flatten the hierarchy", () => {
  // The treatment exists to mark structure. It must keep its uppercase + letter-spacing, or the fix has
  // removed the thing the labels are for.
  for (const sel of LABEL_SELECTORS) {
    const body = rule(sel);
    assert.match(body, /text-transform:\s*uppercase/, `${sel} lost its uppercase treatment`);
    assert.match(body, /letter-spacing/, `${sel} lost its letter-spacing`);
  }
});
