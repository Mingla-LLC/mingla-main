/**
 * #2829 W9r — the app's story editor works in blocks (paragraph, H2, H3,
 * bulleted item, numbered item, quote) whose text carries **bold**, *italic*
 * and [links](https://…). It reads and writes the site's closed rich-text
 * tree (site-contracts richText.ts) — exactly what the published site and
 * Studio's editor can show, nothing more (no photos inside text: the tree has
 * no image node). Round-trips: blocksToDoc(docToBlocks(doc)) keeps the tree.
 */
import type {
  RichTextDoc,
  RichTextInline,
  RichTextText,
} from "../../../packages/site-contracts/src/richText.ts";

export type RichBlockType = "paragraph" | "h2" | "h3" | "bullet" | "number" | "quote";
export type RichBlock = { id: string; type: RichBlockType; text: string };

export const RICH_BLOCK_LABELS: Readonly<Record<RichBlockType, string>> = {
  paragraph: "Paragraph",
  h2: "Heading",
  h3: "Subheading",
  bullet: "Bulleted list",
  number: "Numbered list",
  quote: "Quote",
};

let counter = 0;
export function newBlockId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter}`;
}

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;

function escapeText(text: string): string {
  return text.replace(/([*[\]\\])/g, "\\$1");
}

function markText(node: RichTextText): string {
  let out = escapeText(node.text);
  const marks = node.marks ?? [];
  if (marks.includes("italic")) out = `*${out}*`;
  if (marks.includes("bold")) out = `**${out}**`;
  return out;
}

function inlinesToText(children: readonly RichTextInline[]): string {
  return children.map((child) => {
    if (child.type === "break") return "\n";
    if (child.type === "link") {
      const label = child.children.map((inner) => (inner.type === "break" ? " " : markText(inner))).join("");
      return `[${label}](${child.href})`;
    }
    return markText(child);
  }).join("");
}

/** The site's tree → editable blocks (lists become one block per item). */
export function docToBlocks(doc: RichTextDoc | null | undefined): RichBlock[] {
  if (!doc) return [];
  const blocks: RichBlock[] = [];
  for (const block of doc.children) {
    if (block.type === "paragraph") blocks.push({ id: newBlockId(), type: "paragraph", text: inlinesToText(block.children) });
    else if (block.type === "heading") blocks.push({ id: newBlockId(), type: block.level === 2 ? "h2" : "h3", text: inlinesToText(block.children) });
    else if (block.type === "quote") blocks.push({ id: newBlockId(), type: "quote", text: inlinesToText(block.children) });
    else {
      for (const listItem of block.items) {
        blocks.push({ id: newBlockId(), type: block.ordered ? "number" : "bullet", text: inlinesToText(listItem.children) });
      }
    }
  }
  return blocks;
}

type Token = { text: string; bold: boolean; italic: boolean };

/** **bold**, *italic*, \escapes and line breaks → text nodes (links handled by the caller). */
function parseMarks(source: string, bold = false, italic = false): (Token | "break")[] {
  const out: (Token | "break")[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ text: buffer, bold, italic });
    buffer = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\" && index + 1 < source.length) {
      buffer += source[index + 1];
      index += 1;
    } else if (char === "\n") {
      flush();
      out.push("break");
    } else if (source.startsWith("**", index)) {
      const end = source.indexOf("**", index + 2);
      if (end > index + 2) {
        flush();
        out.push(...parseMarks(source.slice(index + 2, end), true, italic));
        index = end + 1;
      } else buffer += char;
    } else if (char === "*") {
      const end = source.indexOf("*", index + 1);
      if (end > index + 1 && source[end + 1] !== "*") {
        flush();
        out.push(...parseMarks(source.slice(index + 1, end), bold, true));
        index = end;
      } else buffer += char;
    } else buffer += char;
  }
  flush();
  return out;
}

function textNodes(source: string): (RichTextText | { type: "break" })[] {
  return parseMarks(source).map((token) => {
    if (token === "break") return { type: "break" as const };
    const marks: RichTextText["marks"] = [];
    if (token.bold) marks.push("bold");
    if (token.italic) marks.push("italic");
    return marks.length ? { type: "text" as const, text: token.text, marks } : { type: "text" as const, text: token.text };
  });
}

/** One block's text → inline nodes ([label](href) becomes a link when the address is safe). */
export function textToInlines(source: string): RichTextInline[] {
  const out: RichTextInline[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    out.push(...textNodes(source.slice(last, start)));
    const href = match[2]!;
    const label = textNodes(match[1]!);
    if (SAFE_HREF.test(href) && label.length) out.push({ type: "link", href, children: label });
    else out.push(...textNodes(match[0]));
    last = start + match[0].length;
  }
  out.push(...textNodes(source.slice(last)));
  // Merge neighbouring plain texts with the same marks; drop empty ones.
  const merged: RichTextInline[] = [];
  for (const node of out) {
    const previous = merged[merged.length - 1];
    if (node.type === "text" && node.text === "") continue;
    if (node.type === "text" && previous?.type === "text" &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      merged[merged.length - 1] = { ...previous, text: previous.text + node.text };
    } else merged.push(node);
  }
  return merged;
}

/** Editable blocks → the site's tree (empty blocks dropped); null when there are no words. */
export function blocksToDoc(blocks: readonly RichBlock[]): RichTextDoc | null {
  const children: RichTextDoc["children"] = [];
  for (const block of blocks) {
    const inlines = textToInlines(block.text.replace(/\s+$/g, ""));
    if (!inlines.length) continue;
    if (block.type === "paragraph") children.push({ type: "paragraph", children: inlines });
    else if (block.type === "h2" || block.type === "h3") children.push({ type: "heading", level: block.type === "h2" ? 2 : 3, children: inlines });
    else if (block.type === "quote") children.push({ type: "quote", children: inlines });
    else {
      const ordered = block.type === "number";
      const previous = children[children.length - 1];
      const item = { type: "list_item" as const, children: inlines };
      if (previous?.type === "list" && previous.ordered === ordered) previous.items.push(item);
      else children.push({ type: "list", ordered, items: [item] });
    }
  }
  return children.length ? { type: "doc", children } : null;
}

/** Wrap the selected part of a block's text in a mark (Bold / Italic buttons). */
export function wrapSelection(
  text: string,
  selection: { start: number; end: number },
  mark: "bold" | "italic",
): { text: string; selection: { start: number; end: number } } {
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.min(text.length, Math.max(selection.start, selection.end));
  const fence = mark === "bold" ? "**" : "*";
  const inner = text.slice(start, end) || (mark === "bold" ? "bold text" : "italic text");
  const next = `${text.slice(0, start)}${fence}${inner}${fence}${text.slice(end)}`;
  return { text: next, selection: { start: start + fence.length, end: start + fence.length + inner.length } };
}

/** Turn the selection into a link (the Link button). */
export function linkSelection(
  text: string,
  selection: { start: number; end: number },
  href: string,
): { text: string } | null {
  if (!SAFE_HREF.test(href.trim())) return null;
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.min(text.length, Math.max(selection.start, selection.end));
  const label = text.slice(start, end) || href.trim();
  return { text: `${text.slice(0, start)}[${label}](${href.trim()})${text.slice(end)}` };
}
