/**
 * #4420 SC-15 — links in Host Messages text. Pure: no React, no platform.
 *
 * The rule is copied from the Explorer's tokenizer (app-mobile
 * src/utils/messageTextTokens.ts, #4114), not imported across apps:
 *   - only http://, https:// and www. addresses are links (a www. address
 *     opens as https); javascript:, data:, file: and custom schemes never
 *     match, and the opener refuses anything that is not http(s) anyway;
 *   - trailing sentence punctuation and an unmatched closing bracket stay
 *     text ("see https://x.com/a." and "(https://x.com)");
 *   - a link must start a word (not "foo.www.bar").
 * Emails and phone numbers are not links (the Explorer rule does not do them).
 */

export type MessageLinkToken =
  | { type: "text"; text: string }
  | { type: "link"; text: string; url: string };

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", "'", '"']);
const CLOSING_PAIR: Record<string, string> = { ")": "(", "]": "[" };

/**
 * #4420 P2-1 — one pass: bracket counts are taken once and the end index walks
 * back, so the trim is linear (it used to re-split the whole link for every
 * trailing ")" or "]", worse than n^2 on a 4,000-char message).
 * Drops trailing sentence punctuation, and a closing bracket only when it has
 * no opening partner inside the link ("(see https://a.com)" keeps the ")" as
 * text; "https://w.org/A_(b)" keeps it).
 */
function trimLinkEnd(raw: string): string {
  const open: Record<string, number> = { "(": 0, "[": 0 };
  const close: Record<string, number> = { ")": 0, "]": 0 };
  for (const char of raw) {
    if (char in open) open[char] += 1;
    else if (char in close) close[char] += 1;
  }
  let end = raw.length;
  while (end > 0) {
    const char = raw[end - 1];
    if (TRAILING_PUNCTUATION.has(char)) {
      end -= 1;
      continue;
    }
    const partner = CLOSING_PAIR[char];
    if (partner !== undefined && close[char] > open[partner]) {
      close[char] -= 1;
      end -= 1;
      continue;
    }
    break;
  }
  return raw.slice(0, end);
}

/** The url a link opens: a www. address gets https://. */
export function messageLinkHref(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/** Only http(s) urls are ever opened. */
export function isOpenableMessageLink(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+/i.test(url);
}

/** Splits text into plain text and link tokens. Text with no link is one text token. */
export function linkifyMessageText(text: string): MessageLinkToken[] {
  const tokens: MessageLinkToken[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const start = match.index;
    if (start > 0 && /[\w.@/]/.test(text[start - 1])) continue;
    const linkText = trimLinkEnd(match[0]);
    if (linkText.length === 0 || /^(https?:\/\/|www\.)$/i.test(linkText)) continue;
    const url = messageLinkHref(linkText);
    if (!isOpenableMessageLink(url)) continue;
    if (start > lastIndex) tokens.push({ type: "text", text: text.slice(lastIndex, start) });
    tokens.push({ type: "link", text: linkText, url });
    lastIndex = start + linkText.length;
    URL_PATTERN.lastIndex = lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", text: text.slice(lastIndex) });
  return tokens.length ? tokens : [{ type: "text", text }];
}
