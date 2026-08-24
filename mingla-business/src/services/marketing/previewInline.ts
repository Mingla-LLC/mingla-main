/**
 * #2521 — inline markup for the composer's inbox preview.
 *
 * The preview rendered each paragraph as a bare React Native `<Text>`, and
 * `<Text>` shows its children LITERALLY. So a body containing
 * `<a href="…">Get your free ticket</a>` displayed the tag itself, and the
 * organiser reasonably concluded the recipient would receive that gibberish.
 *
 * They would not: `renderMarketingEmail` parses the anchor and rewrites it to
 * a tracked link. Proven in production — the 189 `We Go Again` emails on
 * 2026-08-24 wrote 197 `marketing_clicks` rows, one per recipient. The email
 * was right and the PREVIEW was lying.
 *
 * This reuses `bodyHtmlToTenTapDoc`, the SAME parser the editor uses, rather
 * than a second regex that could drift from it. One parser, one answer: what
 * the editor thinks is a link, the preview draws as a link.
 */

import {
  bodyHtmlToTenTapDoc,
  type InlineNode,
  type TextMark,
} from "./tenTapTokenBridge";

export interface PreviewSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Present when this span is a link — the destination, for a11y hints. */
  href: string | null;
}

function markOf(
  marks: TextMark[] | undefined,
): { bold: boolean; italic: boolean; href: string | null } {
  let bold = false;
  let italic = false;
  let href: string | null = null;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") bold = true;
    else if (mark.type === "italic") italic = true;
    else if (mark.type === "link") href = mark.attrs.href;
  }
  return { bold, italic, href };
}

function spansOfInline(nodes: InlineNode[] | undefined): PreviewSpan[] {
  const out: PreviewSpan[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      const { bold, italic, href } = markOf(node.marks);
      out.push({ text: node.text, bold, italic, href });
    } else if (node.type === "hardBreak") {
      out.push({ text: "\n", bold: false, italic: false, href: null });
    } else if (node.type === "personalizationChip") {
      // Shown as the token itself. Substitution already ran upstream in
      // `previewBlocks`; anything still here had no value to substitute.
      const { bold, italic, href } = markOf(node.marks);
      out.push({ text: `{${node.attrs.token}}`, bold, italic, href });
    }
    // eventChip is handled as its own BLOCK by previewBlocks and never
    // reaches here; drawing it inline too would double it.
  }
  return out;
}

/**
 * Parse one paragraph of body HTML into styled spans.
 *
 * Paragraph-internal newlines are preserved as their own spans so the preview
 * keeps the shape `renderMarketingEmail` now gives the real email (#2520).
 */
export function previewSpans(paragraphHtml: string): PreviewSpan[] {
  const doc = bodyHtmlToTenTapDoc(paragraphHtml);
  const out: PreviewSpan[] = [];
  doc.content.forEach((block, index) => {
    if (index > 0) {
      out.push({ text: "\n", bold: false, italic: false, href: null });
    }
    out.push(...spansOfInline(block.content));
  });
  return out;
}
