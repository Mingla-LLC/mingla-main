export interface BrandGroupMentionCandidate {
  user_id: string;
  display_name: string;
  username: string | null;
}

export interface BrandGroupMentionTarget {
  start: number;
  end: number;
  query: string;
}

export interface SelectedBrandGroupMention {
  userId: string;
  displayName: string;
}

/**
 * Returns the unfinished @token immediately before the caret. Selected names
 * may contain spaces, but discovery deliberately stops at whitespace so the
 * autocomplete never reopens while somebody continues typing after a choice.
 */
export function brandGroupMentionTarget(
  value: string,
  caret: number,
): BrandGroupMentionTarget | null {
  const boundedCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, boundedCaret);
  const match = beforeCaret.match(/(?:^|[\s(])@([^\s@]{0,40})$/u);
  if (!match) return null;
  const at = beforeCaret.lastIndexOf("@");
  return { start: at, end: boundedCaret, query: match[1] ?? "" };
}

export function insertBrandGroupMention(
  value: string,
  target: BrandGroupMentionTarget,
  candidate: BrandGroupMentionCandidate,
): { value: string; caret: number; mention: SelectedBrandGroupMention } {
  const displayName = candidate.display_name.replace(/\s+/gu, " ").trim();
  const token = `@${displayName} `;
  const nextValue = `${value.slice(0, target.start)}${token}${value.slice(target.end)}`;
  return {
    value: nextValue,
    caret: target.start + token.length,
    mention: { userId: candidate.user_id, displayName },
  };
}

/**
 * A selected recipient stops being a mention as soon as its visible token is
 * removed. This prevents a deleted name from still receiving a notification.
 */
export function retainedBrandGroupMentions(
  value: string,
  selected: SelectedBrandGroupMention[],
): SelectedBrandGroupMention[] {
  return selected.filter((mention) => {
    const escapedName = mention.displayName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(
      `(?:^|[\\s(])@${escapedName}(?![\\p{L}\\p{N}_])`,
      "u",
    ).test(value);
  });
}
