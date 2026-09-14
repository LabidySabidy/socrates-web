/**
 * markdown.test.ts — tier 1 of the rendering decision.
 *
 * The property that matters most is the NEGATIVE one: nothing in the tutor's text can become markup. A tag
 * is shown as text, a `javascript:` link is inert, and the parser returns data structures rather than an
 * HTML string — so React renders every character and there is no `dangerouslySetInnerHTML` in the app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, safeHref } from "./markdown.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const textOf = (spans: ReturnType<typeof parseInline>) => spans.map((s) => s.text).join("");

test("emphasis renders instead of showing its asterisks", () => {
  // The reason this exists: 28 real tutor replies use **bold** and the learner was reading the asterisks.
  const spans = parseInline("The **key** point is *this* one");
  assert.deepEqual(spans.map((s) => s.kind), ["text", "strong", "text", "em", "text"]);
  assert.equal(textOf(spans), "The key point is this one");
});

test("inline code is literal, so emphasis inside it is not interpreted", () => {
  const spans = parseInline("use `**not bold**` here");
  const code = spans.find((s) => s.kind === "code");
  assert.ok(code, "the code span is recognised");
  assert.equal(code!.kind === "code" ? code!.text : "", "**not bold**", "its contents are untouched");
});

test("an unclosed marker stays literal rather than eating the rest of the line", () => {
  const spans = parseInline("a **b without a close");
  assert.equal(textOf(spans), "a **b without a close");
});

test("A TAG IS SHOWN AS TEXT — the central guarantee of this tier", () => {
  // No HTML passthrough. React renders the characters; there is no innerHTML anywhere in the app.
  const blocks = parseMarkdown('before <img src=x onerror="alert(1)"> after');
  assert.equal(blocks.length, 1);
  const spans = blocks[0].kind === "paragraph" ? blocks[0].spans : [];
  assert.equal(textOf(spans), 'before <img src=x onerror="alert(1)"> after', "every character survives as text");
  assert.deepEqual(spans.map((s) => s.kind), ["text"], "and none of it becomes markup");
});

test("javascript: and data: links are made inert", () => {
  assert.equal(safeHref("javascript:alert(1)"), "#");
  assert.equal(safeHref("JaVaScRiPt:alert(1)"), "#", "case does not defeat it");
  assert.equal(safeHref("data:text/html,<script>alert(1)</script>"), "#");
  assert.equal(safeHref("https://example.com/x"), "https://example.com/x");
  assert.equal(safeHref("/api/courses"), "/api/courses");
  const link = parseInline("[click](javascript:alert(1))").find((s) => s.kind === "link");
  assert.equal(link!.kind === "link" ? link!.href : "", "#", "and the parser uses the safe form");
});

test("fenced code blocks keep their language and their exact content", () => {
  const blocks = parseMarkdown("text\n\n```json\n{\n  \"a\": 1\n}\n```\n\nmore");
  const code = blocks.find((b) => b.kind === "code");
  assert.ok(code);
  assert.equal(code!.kind === "code" ? code!.language : "", "json");
  assert.equal(code!.kind === "code" ? code!.text : "", '{\n  "a": 1\n}');
});

test("html and svg fences become renderable blocks; mermaid becomes an unrendered note", () => {
  const html = parseMarkdown("```html\n<p>hi</p>\n```");
  assert.equal(html[0].kind, "html");
  const svg = parseMarkdown("```svg\n<svg/>\n```");
  assert.equal(svg[0].kind, "svg");
  // mermaid is NOT parsed by the app — the tutor is asked to emit SVG instead, so a mermaid block is
  // surfaced honestly rather than silently dropped or half-rendered.
  const mermaid = parseMarkdown("```mermaid\ngraph TD; A-->B\n```");
  assert.equal(mermaid[0].kind, "unrendered");
  assert.match(mermaid[0].kind === "unrendered" ? mermaid[0].language : "", /mermaid/);
});

test("a raw <svg> block is recognised without a fence", () => {
  const blocks = parseMarkdown('Here is a diagram:\n\n<svg viewBox="0 0 10 10">\n<circle r="4"/>\n</svg>\n\ndone');
  const svg = blocks.find((b) => b.kind === "svg");
  assert.ok(svg, `expected an svg block, got ${JSON.stringify(blocks.map((b) => b.kind))}`);
  assert.match(svg!.kind === "svg" ? svg!.text : "", /<circle/);
  // the surrounding text is still rendered
  assert.ok(blocks.some((b) => b.kind === "paragraph"));
});

test("lists, headings, rules and tables parse", () => {
  const md = [
    "## A heading",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "---",
    "",
    "| A | B |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");
  const kinds = parseMarkdown(md).map((b) => b.kind);
  assert.deepEqual(kinds, ["heading", "list", "list", "rule", "table"]);
  const table = parseMarkdown(md).find((b) => b.kind === "table");
  assert.deepEqual(table!.kind === "table" ? table!.head : [], ["A", "B"]);
  assert.deepEqual(table!.kind === "table" ? table!.rows : [], [["1", "2"]]);
});

test("an unrecognised construct falls through to a paragraph rather than vanishing", () => {
  // The rule the older parsers in this project follow, for the same reason: a dropped line is invisible.
  const blocks = parseMarkdown("> a quote nobody implemented\n> second line");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.match(blocks[0].kind === "paragraph" ? textOf(blocks[0].spans) : "", /a quote nobody implemented/);
});

test("an empty or blank reply produces no blocks, not a stray paragraph", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\n\n   \n"), []);
});

test("a TABLE CELL is parsed for markup too, not emitted raw", () => {
  // Found on the real course: a tutor reply put **bold** inside a table, and the cells were rendered as plain
  // text so the asterisks showed. The cells go through the same inline parser as everything else.
  const blocks = parseMarkdown("| A | B |\n|---|---|\n| **bold** | plain |");
  const table = blocks[0];
  assert.equal(table.kind, "table");
  // The parser hands back the RAW cell text; the renderer parses it. Assert the renderer does so.
  const component = readFileSync(join(import.meta.dirname, "components", "Markdown.tsx"), "utf8");
  assert.match(component, /parseInline\(h\)/, "header cells are parsed inline");
  assert.match(component, /parseInline\(cell\)/, "and body cells");
});
