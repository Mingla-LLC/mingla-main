/**
 * Issue #4114 Wave 3 — pure rules for the inside of a chat. No React Native
 * imports, so every rule runs under Deno.
 *
 * - reactions: aggregate `direct_message_reactions` rows into pills and toggle
 *   your own optimistically;
 * - sender names: only in groups, only on the first bubble of a block, never on
 *   your own messages;
 * - the new-messages divider, day labels, the group typing label;
 * - typing re-broadcast, so the receiver's 4s expiry never flickers;
 * - composer growth (up to 5 lines);
 * - the long-press menu's actions;
 * - Android back: close the top-most open layer first, then leave the thread.
 */

export interface ReactionRow {
  user_id: string;
  emoji: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** You reacted with this emoji. */
  mine: boolean;
}

/** One pill per emoji, in first-reacted order, with a count and whether you reacted. */
export function aggregateReactions(
  rows: readonly ReactionRow[] | undefined,
  currentUserId: string | null | undefined,
): ReactionSummary[] {
  if (!rows || rows.length === 0) return [];
  const byEmoji = new Map<string, ReactionSummary>();
  for (const row of rows) {
    const existing = byEmoji.get(row.emoji);
    if (existing) {
      existing.count += 1;
      existing.mine = existing.mine || row.user_id === currentUserId;
    } else {
      byEmoji.set(row.emoji, { emoji: row.emoji, count: 1, mine: row.user_id === currentUserId });
    }
  }
  return [...byEmoji.values()];
}

/** Adds your reaction, or removes it if you already reacted with that emoji. */
export function toggleReactionRows(
  rows: readonly ReactionRow[] | undefined,
  userId: string,
  emoji: string,
): ReactionRow[] {
  const list = rows ?? [];
  const mine = list.some((row) => row.user_id === userId && row.emoji === emoji);
  return mine
    ? list.filter((row) => !(row.user_id === userId && row.emoji === emoji))
    : [...list, { user_id: userId, emoji }];
}

export type GroupPosition = "solo" | "first" | "middle" | "last";

/**
 * In a group, the sender's name sits on the FIRST bubble of each block
 * (`groupMessages` positions are chronological, so `first`/`solo` is the top
 * bubble). Never in a 1:1 chat, never on your own messages or system rows.
 */
export function shouldShowSenderName(input: {
  isGroupChat: boolean;
  isMe: boolean;
  isSystem?: boolean;
  groupPosition: GroupPosition;
}): boolean {
  if (!input.isGroupChat || input.isMe || input.isSystem) return false;
  return input.groupPosition === "first" || input.groupPosition === "solo";
}

export interface UnreadCandidate {
  id: string;
  isMe: boolean;
  unread?: boolean;
  isSystem?: boolean;
}

/** The oldest unread incoming message (chronological input), where the divider goes. */
export function firstUnreadMessageId(messages: readonly UnreadCandidate[]): string | null {
  for (const message of messages) {
    if (!message.isMe && !message.isSystem && message.unread) return message.id;
  }
  return null;
}

/** "today" / "yesterday" / a date, by the phone's calendar day. */
export function dayLabelKind(timestamp: string, now: Date): "today" | "yesterday" | "date" {
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (startOfDay === startOfToday) return "today";
  if (startOfDay === startOfToday - 86_400_000) return "yesterday";
  return "date";
}

/** The group typing label as an i18n key + params (keys already in chat.json). */
export function typingLabel(names: readonly string[]): { key: string; params: Record<string, string | number> } | null {
  if (names.length === 0) return null;
  if (names.length === 1) return { key: "chat:isTyping", params: { name: names[0] } };
  if (names.length === 2) return { key: "chat:twoTyping", params: { name1: names[0], name2: names[1] } };
  return { key: "chat:multiTyping", params: { name: names[0], count: names.length - 1 } };
}

/** The receiver drops a typing indicator 4s after the last broadcast. */
export const TYPING_EXPIRY_MS = 4000;
/** So a sender who keeps typing re-broadcasts well inside that window. */
export const TYPING_REBROADCAST_MS = 2500;

export function shouldRebroadcastTyping(lastSentAt: number | null, now: number): boolean {
  return lastSentAt === null || now - lastSentAt >= TYPING_REBROADCAST_MS;
}

/** Composer: grows with the text up to 5 lines, then scrolls inside. */
export const COMPOSER_LINE_HEIGHT = 20;
export const COMPOSER_MAX_LINES = 5;
export const COMPOSER_MIN_HEIGHT = 56;
export const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES;

export type MessageActionId = "reply" | "copy" | "unsend" | "report";

/** The long-press menu: Copy only for text, Unsend for your own sent messages, Report for others'. */
export function messageActions(input: {
  isOwnMessage: boolean;
  type: string;
  isSent: boolean;
  canUnsend: boolean;
  canReport: boolean;
}): MessageActionId[] {
  const actions: MessageActionId[] = ["reply"];
  if (input.type === "text") actions.push("copy");
  if (input.isOwnMessage && input.isSent && input.canUnsend) actions.push("unsend");
  if (!input.isOwnMessage && input.canReport) actions.push("report");
  return actions;
}

/**
 * Android back inside a thread: the first open layer in this list closes;
 * with nothing open the thread itself closes. Order is top-most first.
 */
export const CHAT_BACK_LAYERS = [
  "contextMenu",
  "attachmentMenu",
  "imagePreview",
  "expandedCard",
  "eventDetail",
  "savedCardPicker",
  "mediaSheet",
  "groupInfo",
  "moreMenu",
  "eventAudience",
  "collabDeck",
  "collabMatches",
  "collabPlans",
  "collabPrefs",
] as const;

export type ChatBackLayer = (typeof CHAT_BACK_LAYERS)[number];

export function resolveChatBack(open: Partial<Record<ChatBackLayer, boolean>>): ChatBackLayer | "leaveThread" {
  for (const layer of CHAT_BACK_LAYERS) {
    if (open[layer]) return layer;
  }
  return "leaveThread";
}
