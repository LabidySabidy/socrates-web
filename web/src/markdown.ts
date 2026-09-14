/**
 * markdown.ts — the tutor's prose, rendered.
 *
 * Tier 1 of the rendering decision (DECISIONS.md, 2026-09-14). The tutor's turn was a raw text node, so
 * `**bold**` showed its asterisks — measured across the real transcripts, 28 replies use emphasis and 2 use
 * fenced code. This renders those.
 *
 * NO HTML PASSTHROUGH. A tag in the text is escaped and shown as text, never interpreted. That is the whole
 * reason this tier is separate from the sandboxed one: it has no security surface at all, so it is safe by
 * construction rather than by containment, and it can be depended on where a sandbox would be overkill.
 *
 * The output is a list of BLOCKS, not an HTML string. React renders each block itself, so there is no
 * `dangerouslySetInnerHTML` anywhere in the app and no way for a parse bug to become markup injection.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "heading"; level: number; spans: Inline[] }
  | { kind: "code"; language: string; text: string }
  /** A fenced block the TUTOR should have rendered — surfaced as a note, not as a diagram. */
  | { kind: "unrendered"; language: string; text: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" }
  | { kind: "html"; text: string }
  | { kind: "svg"; text: string };

/** Languages whose fenced blocks are rendered as a diagram frame rather than as code. */
export const DIAGRAM_LANGUAGES = ["mermaid", "svg", "html"] as const;

/**
 * Inline spans within one line of text.
 *
 * Deliberately narrow: bold, italics, code, links. No nested emphasis, no reference links, no footnotes —
 * each of those adds a rule that can be got wrong, and none of them appears in the tutor's actual output.
 * A construct that is not understood stays as literal text rather than being dropped.
 */
export function parseInline(raw: string): Inline[] {
  const spans: Inline[] = [];
  let text = "";
  let i = 0;
  const pushText = () => {
    if (text) spans.push({ kind: "text", text });
    text = "";
  };

  while (i < raw.length) {
    const rest = raw.slice(i);
    // `code` first: its contents are literal, so emphasis inside it must not be interpreted.
    let m = /^`([^`]+)`/.exec(rest);
    if (m) {
      pushText();
      spans.push({ kind: "code", text: m[1] });
      i += m[0].length;
      continue;
    }
    m = /^\*\*([^*]+)\*\*/.exec(rest);
    if (m) {
      pushText();
      spans.push({ kind: "strong", text: m[1] });
      i += m[0].length;
      continue;
    }
    // Single `*`, but not `**` (already handled) and not a bare asterisk mid-word.
    m = /^\*([^*\n]+)\*/.exec(rest);
    if (m) {
      pushText();
      spans.push({ kind: "em", text: m[1] });
      i += m[0].length;
      continue;
    }
    m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (m) {
      pushText();
      spans.push({ kind: "link", text: m[1], href: safeHref(m[2]) });
      i += m[0].length;
      continue;
    }
    text += raw[i];
    i += 1;
  }
  pushText();
  return spans.length > 0 ? spans : [{ kind: "text", text: raw }];
}

/**
 * A link href that cannot execute.
 *
 * `javascript:` and `data:` URLs in a generated reply would be an injection through the one attribute this
 * renderer emits. Anything not clearly a web link or a relative path becomes inert.
 */
export function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return "#";
}

/** A table row's cells, or null when the line is not a table row. */
function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

/** True for the `|---|---|` separator line. */
function isTableRule(line: string): boolean {
  const cells = tableCells(line);
  return cells !== null && cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Split the tutor's text into blocks.
 *
 * Every unrecognised construct falls through to a paragraph, so nothing is ever silently dropped — the same
 * rule the older parsers in this project follow, for the same reason.
 */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced block — ```lang … ```
    const fence = /^\s*```\s*([A-Za-z0-9+-]*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1].toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or end of input)
      const content = body.join("\n");
      if (language === "html") blocks.push({ kind: "html", text: content });
      else if (language === "svg") blocks.push({ kind: "svg", text: content });
      else if (language === "mermaid") blocks.push({ kind: "unrendered", language, text: content });
      else blocks.push({ kind: "code", language, text: content });
      continue;
    }

    // A raw `<svg …>` block, which the tutor may emit instead of fencing it.
    if (/^\s*<svg[\s>]/i.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        body.push(lines[i]);
        if (/<\/svg>\s*$/i.test(lines[i])) {
          i += 1;
          break;
        }
        i += 1;
      }
      blocks.push({ kind: "svg", text: body.join("\n") });
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    // Table: a header row followed by a `|---|` rule
    if (tableCells(line) !== null && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = tableCells(line) ?? [];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const cells = tableCells(lines[i]);
        if (cells === null) break;
        rows.push(cells);
        i += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    // List — `- `, `* `, `+ `, or `1. `
    const bullet = /^\s*[-*+]\s+(.+)$/;
    const numbered = /^\s*\d+[.)]\s+(.+)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = ordered ? numbered.exec(lines[i]) : bullet.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph: consecutive non-blank lines that do not start another block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^\s*```/.test(l)) break;
      if (/^(#{1,6})\s+/.test(l)) break;
      if (/^\s*[-*+]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) break;
      if (tableCells(l) !== null) break;
      if (/^\s*<svg[\s>]/i.test(l)) break;
      para.push(l);
      i += 1;
    }
    if (para.length > 0) blocks.push({ kind: "paragraph", spans: parseInline(para.join(" ")) });
  }

  return blocks;
}
