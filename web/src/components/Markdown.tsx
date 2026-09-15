/**
 * Markdown.tsx — the tutor's blocks, as React elements.
 *
 * The parser returns DATA (`markdown.ts`); this turns it into elements. Nothing here builds an HTML string
 * and nothing sets `innerHTML`, so there is no path from the tutor's text to markup — a tag arrives as text
 * and is rendered as text, which is the guarantee the parser's tests pin.
 *
 * HTML and SVG go to `GeneratedFrame`, which is the sandboxed tier. They are NEVER rendered inline.
 */
import { Fragment, useMemo } from "react";
import { parseInline, parseMarkdown, type Block, type Inline } from "../markdown.ts";
import { GeneratedFrame } from "./GeneratedFrame.tsx";

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.kind) {
          case "strong":
            return <strong key={i}>{s.text}</strong>;
          case "em":
            return <em key={i}>{s.text}</em>;
          case "code":
            return (
              <code className="md-code" key={i}>
                {s.text}
              </code>
            );
          case "link":
            return (
              <a key={i} href={s.href} target="_blank" rel="noreferrer noopener">
                {s.text}
              </a>
            );
          default:
            return <Fragment key={i}>{s.text}</Fragment>;
        }
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      // The tutor's headings are section labels inside a reply, so they start at h3 — an h1 here would put a
      // second document title in the middle of a conversation.
      const Tag = (`h${Math.min(6, block.level + 2)}`) as "h3" | "h4" | "h5" | "h6";
      return <Tag className="md-heading">{<Spans spans={block.spans} />}</Tag>;
    }
    case "code":
      return (
        <pre className="md-pre" data-language={block.language || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "unrendered":
      // A mermaid block. The app does NOT parse mermaid — the tutor is asked to emit SVG instead — so this
      // says so rather than showing raw diagram source as if it were meaningful.
      return (
        <p className="md-note">
          <span className="eyebrow">diagram</span> This diagram came through as {block.language} source, which
          this app does not render. The code is below.
          <pre className="md-pre">
            <code>{block.text}</code>
          </pre>
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="md-list">
          {block.items.map((item, i) => (
            <li key={i}>
              <Spans spans={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <table className="md-table">
          <thead>
            <tr>
              {/* Cells go through the SAME inline parser as everything else. Emitting them raw left
                  `**bold**` visible inside tables — which is where a real tutor reply put it. */}
              {block.head.map((h, i) => (
                <th key={i}>
                  <Spans spans={parseInline(h)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Spans spans={parseInline(cell)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "rule":
      return <hr className="md-rule" />;
    case "svg":
      // SVG is not inlined: an inline <svg> can carry <script> and event handlers, and it would run with the
      // app's origin. It goes through the same sandbox as HTML.
      return <GeneratedFrame html={block.text} title="Generated diagram" />;
    case "html":
      return <GeneratedFrame html={block.text} title="Generated content" />;
    default:
      return (
        <p className="md-p">
          <Spans spans={block.spans} />
        </p>
      );
  }
}

/** Render the tutor's text. */
export function Markdown({ text }: { text: string }) {
  // MEMOISED. This ran on every render, and a render happened on every streamed delta — so a 6,442-delta turn
  // re-parsed the whole accumulated reply 6,442 times: measured, 6.6M characters for a 2,037-character reply,
  // which is the quadratic that showed Chrome's "Page Unresponsive" (owner, 2026-09-15).
  //
  // `parseMarkdown` is pure and depends only on `text`, so the memo is exact rather than an approximation.
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <BlockView block={b} key={i} />
      ))}
    </div>
  );
}
