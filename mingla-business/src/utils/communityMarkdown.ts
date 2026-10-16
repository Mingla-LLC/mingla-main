export type CommunityMarkdownInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

export type CommunityMarkdownBlock = {
  kind: "paragraph" | "heading" | "bullet" | "numbered" | "quote";
  level?: number;
  ordinal?: number;
  inline: CommunityMarkdownInline[];
};

const SAFE_LINK = /^(?:https:\/\/|mailto:)/i;

export function safeCommunityMarkdownLink(value: string): string | null {
  const trimmed = value.trim();
  return SAFE_LINK.test(trimmed) ? trimmed : null;
}

export function parseCommunityMarkdownInline(
  value: string,
): CommunityMarkdownInline[] {
  const result: CommunityMarkdownInline[] = [];
  const pattern =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      result.push({ text: value.slice(cursor, match.index) });
    }
    if (match[1] !== undefined) {
      result.push({
        text: match[1],
        href: safeCommunityMarkdownLink(match[2]) ?? undefined,
      });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      result.push({ text: match[3] ?? match[4], bold: true });
    } else if (match[5] !== undefined) {
      result.push({ text: match[5], code: true });
    } else {
      result.push({ text: match[6] ?? match[7], italic: true });
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < value.length) result.push({ text: value.slice(cursor) });
  return result.length > 0 ? result : [{ text: value }];
}

/** Parse the supported, text-only Community Markdown subset for native/web. */
export function parseCommunityMarkdown(
  value: string,
): CommunityMarkdownBlock[] {
  const blocks: CommunityMarkdownBlock[] = [];
  for (const raw of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        inline: parseCommunityMarkdownInline(heading[2]),
      });
      continue;
    }
    const bullet = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
    if (bullet) {
      blocks.push({
        kind: "bullet",
        inline: parseCommunityMarkdownInline(bullet[1]),
      });
      continue;
    }
    const numbered = line.match(/^\s{0,3}(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      blocks.push({
        kind: "numbered",
        ordinal: Number(numbered[1]),
        inline: parseCommunityMarkdownInline(numbered[2]),
      });
      continue;
    }
    const quote = line.match(/^\s{0,3}>\s?(.+)$/);
    if (quote) {
      blocks.push({
        kind: "quote",
        inline: parseCommunityMarkdownInline(quote[1]),
      });
      continue;
    }
    blocks.push({
      kind: "paragraph",
      inline: parseCommunityMarkdownInline(line.trim()),
    });
  }
  return blocks;
}

/**
 * Convert Community Markdown into readable lock-screen/preview text. Push and
 * compact cards must never show authoring symbols such as ###, ** or backticks.
 */
export function communityMarkdownToPlainText(value: string): string {
  return value
    .replace(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/(^|\n)\s{0,3}(?:[-+*]|\d+[.)])\s+/g, "$1")
    .replace(/(^|\n)\s{0,3}>\s?/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}
