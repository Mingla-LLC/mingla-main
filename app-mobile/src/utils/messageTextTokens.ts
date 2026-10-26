/**
 * Issue #4114 (simulator QA run 2): how a text bubble's content is split into
 * plain text, links and mentions. Dependency-free so it runs under Deno.
 *
 *   * Links: http(s):// and www. addresses become tappable link tokens
 *     (trailing sentence punctuation and an unmatched closing bracket stay
 *     text). A www. address opens as https.
 *   * Mentions with offsets (the composer's structured mentions) are used as
 *     they are.
 *   * A message with no mention data only styles "@Name" when Name is a real
 *     participant of this chat (longest name first, then a word boundary).
 *     Anything else after "@" is plain text: the old fallback underlined
 *     everything from "@" to the end of the message (evidence 06).
 */

export type MessageTextToken =
  | { type: "text"; text: string }
  | { type: "link"; text: string; url: string }
  | { type: "mention"; text: string; userId: string | null; displayName: string };

export interface StructuredMention {
  userId: string;
  displayName: string;
  startOffset: number;
  endOffset: number;
}

export interface MentionCandidate {
  userId: string;
  displayName: string;
}

/**
 * Issue #4114 QA run 3: "@Your Name" is styled too. The chat's participant
 * list leaves the current user out (you are never a mention suggestion), so
 * the styling list adds you back. No id or no usable name: unchanged. Already
 * present: unchanged.
 */
export function withSelfMentionCandidate(
  participants: readonly MentionCandidate[],
  currentUserId: string | null | undefined,
  currentUserName: string | null | undefined,
): MentionCandidate[] {
  const name = typeof currentUserName === "string" ? currentUserName.trim() : "";
  if (!currentUserId || !name || participants.some((p) => p.userId === currentUserId)) {
    return [...participants];
  }
  return [...participants, { userId: currentUserId, displayName: name }];
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:'"]+$/;

function trimLinkEnd(raw: string): string {
  let value = raw.replace(TRAILING_PUNCTUATION, "");
  // Drop closing brackets that have no opening partner inside the link
  // ("(see https://a.com)" keeps the ")" as text; "https://w.org/A_(b)" keeps it).
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"]];
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

/** The url a link token opens: www. addresses get https://. */
export function linkHref(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/** Splits plain text into text and link tokens. */
export function linkifyText(text: string): MessageTextToken[] {
  const tokens: MessageTextToken[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const start = match.index;
    // A link must start a word (not "foo.www.bar").
    if (start > 0 && /[\w.@/]/.test(text[start - 1])) continue;
    const linkText = trimLinkEnd(match[0]);
    if (linkText.length === 0 || /^(https?:\/\/|www\.)$/i.test(linkText)) continue;
    if (start > lastIndex) tokens.push({ type: "text", text: text.slice(lastIndex, start) });
    tokens.push({ type: "link", text: linkText, url: linkHref(linkText) });
    lastIndex = start + linkText.length;
    URL_PATTERN.lastIndex = lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", text: text.slice(lastIndex) });
  return tokens;
}

function pushText(tokens: MessageTextToken[], text: string): void {
  if (text.length === 0) return;
  tokens.push(...linkifyText(text));
}

/** "@Name" at `at` when Name is a participant (longest match), else null. */
function participantAt(
  content: string,
  at: number,
  candidates: MentionCandidate[],
): { candidate: MentionCandidate; end: number } | null {
  if (content[at] !== "@") return null;
  if (at > 0 && !/\s|[(\[]/.test(content[at - 1])) return null;
  const rest = content.slice(at + 1).toLowerCase();
  let best: { candidate: MentionCandidate; end: number } | null = null;
  for (const candidate of candidates) {
    const name = candidate.displayName.trim();
    if (!name) continue;
    if (!rest.startsWith(name.toLowerCase())) continue;
    const end = at + 1 + name.length;
    const next = content[end];
    if (next !== undefined && /[\p{L}\p{N}_]/u.test(next)) continue;
    if (!best || end > best.end) best = { candidate, end };
  }
  return best;
}

export function tokenizeMessageText(
  content: string,
  structuredMentions: StructuredMention[],
  candidates: MentionCandidate[],
): MessageTextToken[] {
  const tokens: MessageTextToken[] = [];
  const structured = structuredMentions
    .filter((mention) =>
      Number.isInteger(mention.startOffset) &&
      Number.isInteger(mention.endOffset) &&
      mention.startOffset >= 0 &&
      mention.endOffset > mention.startOffset &&
      mention.startOffset < content.length,
    )
    .sort((a, b) => a.startOffset - b.startOffset);

  if (structured.length > 0) {
    let lastIndex = 0;
    for (const mention of structured) {
      const start = Math.max(mention.startOffset, lastIndex);
      const end = Math.min(mention.endOffset, content.length);
      if (end <= start) continue;
      pushText(tokens, content.slice(lastIndex, start));
      tokens.push({
        type: "mention",
        text: content.slice(start, end),
        userId: mention.userId,
        displayName: mention.displayName || content.slice(start, end).replace(/^@/, ""),
      });
      lastIndex = end;
    }
    pushText(tokens, content.slice(lastIndex));
    return tokens;
  }

  let lastIndex = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== "@") continue;
    const hit = participantAt(content, i, candidates);
    if (!hit) continue;
    pushText(tokens, content.slice(lastIndex, i));
    tokens.push({
      type: "mention",
      text: content.slice(i, hit.end),
      userId: hit.candidate.userId,
      displayName: hit.candidate.displayName.trim(),
    });
    lastIndex = hit.end;
    i = hit.end - 1;
  }
  pushText(tokens, content.slice(lastIndex));
  return tokens;
}
