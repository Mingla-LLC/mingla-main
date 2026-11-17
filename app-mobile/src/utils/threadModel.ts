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
  /** Issue #4114 QA: set once the server row is known (live DELETEs match by id). */
  id?: string;
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

/** The newest message in the thread, as the scroll logic sees it. */
export interface NewestMessage {
  id: string;
  /** Row key: the client id when present, so an optimistic copy and its confirmed row match. */
  key: string;
  isMine: boolean;
}

export type NewestArrivalAction = "none" | "jumpToLatest" | "countUnseen";

/**
 * Issue #4114: what the thread does when its newest message changes.
 * - Your own new message (text, card, media) always jumps to the latest, even
 *   when you were reading higher up.
 * - Someone else's message while you are scrolled up does not move you; it
 *   bumps the scroll-to-latest count. At the bottom, the list keeps following
 *   on its own (maintainVisibleContentPosition).
 * - The same message again (its optimistic copy confirmed, or a retry of a
 *   failed one) is not a new arrival, and neither is the first load.
 */
export function newestArrivalAction(
  previous: NewestMessage | null,
  next: NewestMessage | null,
  awayFromLatest: boolean,
): NewestArrivalAction {
  if (!previous || !next) return "none";
  const sameMessage =
    next.id === previous.id || next.key === previous.key || next.id === previous.key || next.key === previous.id;
  if (sameMessage) return "none";
  if (next.isMine) return "jumpToLatest";
  return awayFromLatest ? "countUnseen" : "none";
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

export type MessageActionId = "reply" | "copy" | "report" | "deleteForMe" | "unsend" | "removeForEveryone";

/** Issue #4456: the message types a person can unsend (plan cards and system rows are server-owned). */
export const UNSENDABLE_MESSAGE_TYPES: readonly string[] = ["text", "image", "video", "file", "card"];

export function isUnsendableType(type: string | null | undefined): boolean {
  return UNSENDABLE_MESSAGE_TYPES.includes(type ?? "text");
}

/**
 * Issue #4456: the long-press menu, in the design's order. Group 1 holds
 * everyday actions (Reply, Copy for text, Report on someone else's message);
 * group 2 holds the two delete actions (Delete for me, then Unsend for
 * everyone on your own message or Remove for everyone for a group admin).
 * There is no time limit on Unsend (Seth, 2026-11-16).
 *
 * - An unsent line offers Delete for me only.
 * - A failed (never sent) bubble offers Delete for me only (local).
 * - A message still uploading has no menu (its own cancel stays).
 * - View once: Delete for me and Unsend (yours) or Report and Delete for me
 *   (someone else's); no Reply or Copy, and admins cannot remove it.
 */
export function messageActions(input: {
  isOwnMessage: boolean;
  type: string;
  isSent: boolean;
  isFailed?: boolean;
  isTombstone?: boolean;
  isViewOnce?: boolean;
  isGroupAdmin?: boolean;
  canUnsend: boolean;
  canReport: boolean;
  canDeleteForMe?: boolean;
}): MessageActionId[] {
  const canDelete = input.canDeleteForMe !== false;
  if (input.isTombstone) return canDelete ? ["deleteForMe"] : [];
  if (input.isFailed) return canDelete ? ["deleteForMe"] : [];
  if (!input.isSent) return [];
  const unsendable = isUnsendableType(input.type);
  const actions: MessageActionId[] = [];
  if (!input.isViewOnce) {
    actions.push("reply");
    if (input.type === "text") actions.push("copy");
  }
  if (!input.isOwnMessage && input.canReport) actions.push("report");
  if (canDelete) actions.push("deleteForMe");
  if (input.isOwnMessage && input.canUnsend && unsendable) actions.push("unsend");
  if (!input.isOwnMessage && input.isGroupAdmin && input.canUnsend && unsendable && !input.isViewOnce) {
    actions.push("removeForEveryone");
  }
  return actions;
}

/** Issue #4456: actions that change something on the server, refused while offline. */
export const NEEDS_CONNECTION_ACTIONS: ReadonlySet<MessageActionId> = new Set<MessageActionId>([
  "deleteForMe",
  "unsend",
  "removeForEveryone",
]);

/** Issue #4456: the menu's two groups (everyday actions, then the delete actions). */
export function messageActionGroups(actions: readonly MessageActionId[]): MessageActionId[][] {
  const deletes = new Set<MessageActionId>(["deleteForMe", "unsend", "removeForEveryone"]);
  return [actions.filter((id) => !deletes.has(id)), actions.filter((id) => deletes.has(id))]
    .filter((group) => group.length > 0);
}

export type TombstoneKind = "sender" | "admin";

/**
 * Issue #4456: the unsent line, as an i18n key and params.
 * - unsent by its author: "You unsent a message" / "Ana unsent a message";
 * - removed by a group admin: "You removed a message" (you are the admin),
 *   "Sam removed your message" (you wrote it), "Sam removed a message".
 */
export function tombstoneLine(input: {
  kind: TombstoneKind;
  authorIsMe: boolean;
  actorIsMe: boolean;
  authorName: string;
  actorName: string;
}): { key: string; params: Record<string, string> } {
  if (input.kind === "admin") {
    if (input.actorIsMe) return { key: "chat:tombstoneYouRemoved", params: {} };
    if (input.authorIsMe) return { key: "chat:tombstoneAdminRemovedYours", params: { name: input.actorName } };
    return { key: "chat:tombstoneAdminRemoved", params: { name: input.actorName } };
  }
  if (input.authorIsMe) return { key: "chat:tombstoneYouUnsent", params: {} };
  return { key: "chat:tombstoneTheyUnsent", params: { name: input.authorName } };
}

export interface MessageTombstone {
  kind: TombstoneKind;
  /** Who unsent or removed it (null when that account was deleted). */
  byUserId: string | null;
}

/**
 * Issue #4456: how a stored row reads in the thread. A message unsent by its
 * author or removed by a group admin becomes a placeholder (`tombstone`); any
 * other removal (Host moderation, account deletion, rows from before #4456)
 * stays hidden (`unsent`), as before.
 */
export function unsentStateOf(row: {
  deleted_at?: string | null;
  unsent_kind?: string | null;
  unsent_by?: string | null;
}): { unsent?: true; tombstone?: MessageTombstone } {
  if (!row.deleted_at) return {};
  if (row.unsent_kind === "sender" || row.unsent_kind === "admin") {
    return { tombstone: { kind: row.unsent_kind, byUserId: row.unsent_by ?? null } };
  }
  return { unsent: true };
}

/** Issue #4456: how long Delete for me can be undone (10 s while a screen reader is on). */
export const DELETE_FOR_ME_UNDO_MS = 5000;
export const DELETE_FOR_ME_UNDO_SCREEN_READER_MS = 10000;

/** Issue #4456: the most messages one unsend can name (an album is one call). */
export const UNSEND_MAX_IDS = 10;

/**
 * Issue #4456: what a reply quote shows for its original. An unsent original
 * reads "Message unsent" (no thumbnail); one hidden for me, or one that cannot
 * be loaded, reads "Message not available".
 */
export type ReplyQuoteState = "live" | "unsent" | "unavailable";

export function replyQuoteState(original: { tombstone?: unknown; unsent?: boolean } | undefined): ReplyQuoteState {
  if (!original) return "unavailable";
  if (original.tombstone) return "unsent";
  if (original.unsent) return "unavailable";
  return "live";
}

/**
 * Android back inside a thread: the first open layer in this list closes;
 * with nothing open the thread itself closes. Order is top-most first.
 */
export const CHAT_BACK_LAYERS = [
  // Issue #4456: the unsend confirm sits above the menu it opens from.
  "unsendConfirm",
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
  "sendTarget",
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

/**
 * Issue #4114 QA: opening a chat marks EVERY unread message in it read, not
 * just the newest loaded page, so a chat with more unread than one page does
 * not keep its badge (it reappeared after loading older messages). The ids
 * from others that have no read row yet, in order, de-duplicated.
 */
export function idsStillUnread(messageIds: readonly string[], readIds: Iterable<string>): string[] {
  const read = new Set(readIds);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of messageIds) {
    if (!id || read.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Upsert batch size for marking a whole chat read. */
export const MARK_READ_CHUNK = 500;

/**
 * Issue #4114 QA (P3): a failed send used to show an alert AND the bubble's
 * "Tap to retry". A retryable failure now shows only the inline retry; a send
 * the server refused for good (blocked, not allowed) gets a toast, since
 * retrying it cannot work.
 */
export type SendFailureFeedback = "inline_retry" | "toast_not_allowed";

export function sendFailureFeedback(sendError: string | null | undefined): SendFailureFeedback {
  const text = sendError ?? "";
  return /Cannot|blocked|policy/.test(text) ? "toast_not_allowed" : "inline_retry";
}

/**
 * Issue #4261: the open chat's list row, between two renders. A list refresh
 * can land before the open chat's read receipt saves and count a line I just
 * caused. Only a row that was clear and turned unread while the same chat stayed
 * open qualifies: opening a chat keeps its own read flow (and its new-messages
 * divider), and a chat that is not open keeps its unread count.
 */
export function openChatRowTurnedUnread(
  previous: { conversationId: string | null; unread: number },
  next: { conversationId: string | null; unread: number },
): boolean {
  return next.conversationId !== null
    && previous.conversationId === next.conversationId
    && previous.unread === 0
    && next.unread > 0;
}
