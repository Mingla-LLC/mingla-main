import {
  assertRichText,
  type RichTextBlock,
  type RichTextDoc,
  type RichTextInline,
  type RichTextMark,
  type RichTextText,
} from "../contracts/generated/richText.ts";
import { isSafeHref } from "../contracts/generated/safety.ts";

/*
 * #2829 W3/W5 (S-11) — Studio edits rich text in Lexical; a published site
 * only ever sees the closed rich-text tree from site-contracts. This turns a
 * stored Lexical value into that tree: paragraphs, headings (2–4), lists,
 * quotes, line breaks, safe links, and the five text marks. Anything else
 * keeps its words as a plain paragraph (nothing a writer typed is lost) and
 * never its markup. The result is validated before it is returned.
 */
type Node = Record<string, unknown>;

const FORMAT_MARKS: ReadonlyArray<[number, RichTextMark]> = [
  [1, "bold"],
  [2, "italic"],
  [4, "strike"],
  [8, "underline"],
  [16, "code"],
];

function children(node: Node): Node[] {
  return Array.isArray(node.children) ? (node.children as Node[]).filter((child) => child && typeof child === "object") : [];
}

function textNode(node: Node): RichTextText | null {
  if (typeof node.text !== "string" || node.text === "") return null;
  const format = typeof node.format === "number" ? node.format : 0;
  const marks = FORMAT_MARKS.filter(([bit]) => (format & bit) !== 0).map(([, mark]) => mark);
  return marks.length ? { type: "text", text: node.text, marks } : { type: "text", text: node.text };
}

function inlines(node: Node): RichTextInline[] {
  const out: RichTextInline[] = [];
  for (const child of children(node)) {
    if (child.type === "linebreak") {
      out.push({ type: "break" });
    } else if (child.type === "link" || child.type === "autolink") {
      const url = (child.fields as Node | undefined)?.url ?? child.url;
      const inner = inlines(child).filter((item): item is RichTextText | { type: "break" } => item.type !== "link");
      if (typeof url === "string" && isSafeHref(url) && inner.length) out.push({ type: "link", href: url, children: inner });
      else out.push(...inner);
    } else if (typeof child.text === "string") {
      const text = textNode(child);
      if (text) out.push(text);
    } else {
      out.push(...inlines(child));
    }
  }
  return out;
}

function plain(node: Node): string {
  if (typeof node.text === "string") return node.text;
  return children(node).map(plain).join(" ").replace(/\s+/g, " ").trim();
}

function block(node: Node): RichTextBlock[] {
  switch (node.type) {
    case "paragraph": {
      const content = inlines(node);
      return content.length ? [{ type: "paragraph", children: content }] : [];
    }
    case "heading": {
      const tag = typeof node.tag === "string" ? node.tag : "h2";
      const level = tag === "h3" ? 3 : tag === "h4" || tag === "h5" || tag === "h6" ? 4 : 2;
      const content = inlines(node);
      return content.length ? [{ type: "heading", level, children: content }] : [];
    }
    case "quote": {
      const content = inlines(node);
      return content.length ? [{ type: "quote", children: content }] : [];
    }
    case "list": {
      const items = children(node)
        .filter((child) => child.type === "listitem")
        .map((child) => ({ type: "list_item" as const, children: inlines(child) }))
        .filter((item) => item.children.length > 0);
      return items.length ? [{ type: "list", ordered: node.listType === "number", items }] : [];
    }
    default: {
      const words = plain(node);
      return words ? [{ type: "paragraph", children: [{ type: "text", text: words }] }] : [];
    }
  }
}

/** Lexical (`{root: {...}}` or a bare root) → the closed tree; null when there are no words. */
export function richTextToAst(value: unknown): RichTextDoc | null {
  const root = (value && typeof value === "object" ? ((value as Node).root ?? value) : null) as Node | null;
  if (!root) return null;
  const blocks = children(root).flatMap(block);
  if (!blocks.length) return null;
  const doc: RichTextDoc = { type: "doc", children: blocks };
  assertRichText(doc);
  return doc;
}
