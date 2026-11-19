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
const TRAILING_PUNCTUATION = /[.,!?;:'"]+$/;

function trimLinkEnd(raw: string): string {
  let value = raw.replace(TRAILING_PUNCTUATION, "");
  const pairs: [string, string][] = [["(", ")"], ["[", "]"]];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (value.endsWith(close) && value.split(close).length > value.split(open).length) {
        value = value.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
        changed = true;
      }
    }
  }
  return value;
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
