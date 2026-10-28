import {
  assertRichText,
  type RichTextDoc,
  type RichTextInline,
  type RichTextMark,
  type RichTextText,
} from "../contracts/generated/richText.ts";

/*
 * #2829 W9r — the Business app writes stories and destination stories as the
 * site's closed rich-text tree (site-contracts richText.ts); Studio stores and
 * edits Lexical. This is the inverse of richTextToAst: tree → the Lexical
 * value Studio's siteRichTextEditor() opens (paragraphs, headings 2–4, quotes,
 * bulleted and numbered lists, line breaks, links, the five marks). The tree
 * is validated first, so nothing outside it can be stored this way, and
 * richTextToAst(astToLexical(doc)) returns the same tree (round-trip tested).
 */
type LexicalNode = Record<string, unknown>;

const MARK_BITS: Readonly<Record<RichTextMark, number>> = {
  bold: 1,
  italic: 2,
  strike: 4,
  underline: 8,
  code: 16,
};

const ELEMENT = { format: "", indent: 0, version: 1, direction: "ltr" } as const;

function textNode(node: RichTextText): LexicalNode {
  const format = (node.marks ?? []).reduce((bits, mark) => bits | MARK_BITS[mark], 0);
  return { type: "text", detail: 0, format, mode: "normal", style: "", text: node.text, version: 1 };
}

function inlineNodes(children: readonly RichTextInline[]): LexicalNode[] {
  return children.map((child) => {
    if (child.type === "break") return { type: "linebreak", version: 1 };
    if (child.type === "link") {
      return {
        type: "link",
        ...ELEMENT,
        version: 3,
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 24),
        fields: { url: child.href, newTab: false, linkType: "custom" },
        children: child.children.map((inner) => (inner.type === "break" ? { type: "linebreak", version: 1 } : textNode(inner))),
      };
    }
    return textNode(child);
  });
}

/** The closed tree → `{ root: … }` as Studio stores it. Throws ARTIFACT_RICH_TEXT_MISMATCH on anything else. */
export function astToLexical(doc: unknown): { root: LexicalNode } {
  assertRichText(doc);
  const tree = doc as RichTextDoc;
  const children = tree.children.map((block): LexicalNode => {
    switch (block.type) {
      case "paragraph":
        return { type: "paragraph", ...ELEMENT, textFormat: 0, textStyle: "", children: inlineNodes(block.children) };
      case "heading":
        return { type: "heading", ...ELEMENT, tag: `h${block.level}`, children: inlineNodes(block.children) };
      case "quote":
        return { type: "quote", ...ELEMENT, children: inlineNodes(block.children) };
      case "list":
        return {
          type: "list",
          ...ELEMENT,
          listType: block.ordered ? "number" : "bullet",
          tag: block.ordered ? "ol" : "ul",
          start: 1,
          children: block.items.map((item, index) => ({
            type: "listitem",
            ...ELEMENT,
            value: index + 1,
            children: inlineNodes(item.children),
          })),
        };
    }
  });
  return { root: { type: "root", ...ELEMENT, children } };
}
