/**
 * Issue #4114 Wave 2a — the Chats list model.
 *
 * Pure, dependency-free helpers shared by ConnectionsPage, ChatListItem, the
 * New message sheet and the tab-switch skeleton: row geometry, chat kinds,
 * filters, pin rules, the time label, search grouping and the flat item list
 * the FlatList renders (with fixed heights for getItemLayout).
 *
 * Kept free of React Native imports on purpose so the behaviour can be tested
 * directly under Deno (see __tests__/issue_4114_chat_list_model.implementor.happy.test.ts).
 */

// ── Row geometry (design contract "The chat list") ─────────────────────────
export const CHAT_ROW_HEIGHT = 72;
export const CHAT_AVATAR_SIZE = 52;
export const CHAT_ROW_GAP = 12;
export const CHAT_ROW_SIDE_PADDING = 14;
/** The hairline starts at the text edge: side padding + avatar + gap. */
export const CHAT_SEPARATOR_INSET = CHAT_ROW_SIDE_PADDING + CHAT_AVATAR_SIZE + CHAT_ROW_GAP;
export const CHAT_SECTION_LABEL_HEIGHT = 32;
export const CHAT_ARCHIVED_ROW_HEIGHT = 56;
export const CHAT_HEADER_BUTTON_SIZE = 34;
export const CHAT_SEARCH_HEIGHT = 36;
export const MAX_PINNED_CHATS = 3;

// ── Minimal structural shapes (no imports, so Deno can run this file) ──────
export interface ChatListParticipant {
  id: string;
  username?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

export interface ChatListConversationLike {
  id: string;
  created_at: string;
  type?: "direct" | "group";
  name?: string | null;
  session_id?: string | null;
  linked_entity_type?: "direct" | "session" | "trip" | "event";
  participants: ChatListParticipant[];
  last_message?: { content?: string | null; created_at?: string | null; message_type?: string | null } | null;
  unread_count?: number;
  pinned_at?: string | null;
  marked_unread_at?: string | null;
  __pendingInvite?: unknown;
  __pendingCollabChat?: unknown;
}

export interface ChatListFriendLike {
  id: string;
  user_id: string;
  friend_user_id: string;
  username?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

export type ChatFilter = "all" | "unread" | "groups" | "events";
export const CHAT_FILTERS: readonly ChatFilter[] = ["all", "unread", "groups", "events"];

/**
 * Every kind of chat gets its own shape (design D12):
 *  - direct: a circle;
 *  - direct_collab: a circle with the orange deck badge (a 1:1 chat holding a
 *    live collab session; Wave 5 links these, today none exist);
 *  - group: two stacked circles plus the deck badge (every group is a collab);
 *  - event: a rounded-square cover (event and trip chats).
 */
export type ChatKind = "direct" | "direct_collab" | "group" | "event";

export function chatKind(conversation: ChatListConversationLike): ChatKind {
  if (conversation.type === "group") {
    if (conversation.linked_entity_type === "event" || conversation.linked_entity_type === "trip") {
      return "event";
    }
    return "group";
  }
  return conversation.session_id ? "direct_collab" : "direct";
}

export function isPendingInviteRow(conversation: ChatListConversationLike): boolean {
  return Boolean(conversation.__pendingInvite);
}

export function isMarkedUnread(conversation: ChatListConversationLike): boolean {
  return Boolean(conversation.marked_unread_at) && (conversation.unread_count ?? 0) === 0;
}

export function isUnreadChat(conversation: ChatListConversationLike): boolean {
  return (conversation.unread_count ?? 0) > 0 || Boolean(conversation.marked_unread_at);
}

export function matchesChatFilter(conversation: ChatListConversationLike, filter: ChatFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unread":
      return isUnreadChat(conversation);
    case "groups":
      return chatKind(conversation) === "group";
    case "events":
      return chatKind(conversation) === "event";
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

function activityTime(conversation: ChatListConversationLike): number {
  const value = conversation.last_message?.created_at || conversation.created_at;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Pinned chats first (in the order they were pinned), then most recent activity. */
export function sortChatList<T extends ChatListConversationLike>(conversations: readonly T[]): T[] {
  const pinned = conversations
    .filter((conversation) => Boolean(conversation.pinned_at))
    .sort((a, b) => new Date(a.pinned_at as string).getTime() - new Date(b.pinned_at as string).getTime());
  const rest = conversations
    .filter((conversation) => !conversation.pinned_at)
    .sort((a, b) => activityTime(b) - activityTime(a));
  return [...pinned, ...rest];
}

export function pinnedCount(conversations: readonly ChatListConversationLike[], exceptId?: string): number {
  return conversations.filter((conversation) => Boolean(conversation.pinned_at) && conversation.id !== exceptId).length;
}

/** The client half of the 3-pin rule (the server trigger is the other half). */
export function canPinChat(conversations: readonly ChatListConversationLike[], conversationId: string): boolean {
  const target = conversations.find((conversation) => conversation.id === conversationId);
  if (target?.pinned_at) return true;
  return pinnedCount(conversations, conversationId) < MAX_PINNED_CHATS;
}

export function getInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = parts.map((part) => Array.from(part)[0] ?? "").join("").toUpperCase();
  return Array.from(initials).slice(0, 2).join("") || "?";
}

// ── Time label: "9:38", "Yesterday", weekday, then date ────────────────────
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatChatListTime(
  iso: string | null | undefined,
  now: Date,
  locale: string | undefined,
  yesterdayLabel: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (dayDiff <= 0) {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  if (dayDiff === 1) return yesterdayLabel;
  if (dayDiff < 7) return date.toLocaleDateString(locale, { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Next-event tag text: the date when the event is today or later, else null. */
export function formatUpcomingEventTag(
  iso: string | null | undefined,
  now: Date,
  locale: string | undefined,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (startOfDay(date) < startOfDay(now)) return null;
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

// ── Unread badge (orange; grey when muted — it used to be hidden) ───────────
export interface UnreadBadge {
  visible: boolean;
  tone: "accent" | "muted";
  label: string;
}

export function unreadBadge(conversation: ChatListConversationLike, isMuted: boolean): UnreadBadge {
  const count = conversation.unread_count ?? 0;
  const marked = Boolean(conversation.marked_unread_at);
  if (count <= 0 && !marked) return { visible: false, tone: isMuted ? "muted" : "accent", label: "" };
  return {
    visible: true,
    tone: isMuted ? "muted" : "accent",
    // A chat marked unread with nothing new shows an empty badge, never a made-up count.
    label: count > 99 ? "99+" : count > 0 ? String(count) : "",
  };
}

// ── Search grouping (no server search; loaded data only) ────────────────────
export function normalizeChatSearch(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/^@/, "").replace(/\s+/g, " ").trim();
}

export function friendUserIdOf(friend: ChatListFriendLike, currentUserId: string): string {
  return friend.user_id === currentUserId ? friend.friend_user_id : friend.user_id;
}

export function friendDisplayName(friend: ChatListFriendLike | ChatListParticipant): string {
  const full = [friend.first_name, friend.last_name].filter(Boolean).join(" ").trim();
  return (friend.display_name || "").trim() || full || (friend.username || "").trim() || "";
}

/** Friends you have no direct chat with yet. */
export function friendsWithoutChat<F extends ChatListFriendLike>(
  friends: readonly F[],
  conversations: readonly ChatListConversationLike[],
  currentUserId: string,
): F[] {
  const chatted = new Set<string>();
  for (const conversation of conversations) {
    if (conversation.type === "group") continue;
    for (const participant of conversation.participants) {
      if (participant.id !== currentUserId) chatted.add(participant.id);
    }
  }
  return friends.filter((friend) => !chatted.has(friendUserIdOf(friend, currentUserId)));
}

export function friendMatches(friend: ChatListFriendLike, query: string): boolean {
  const q = normalizeChatSearch(query);
  if (!q) return true;
  const candidates = [friendDisplayName(friend), friend.username || "", [friend.first_name, friend.last_name].filter(Boolean).join(" ")];
  return candidates.some((candidate) => normalizeChatSearch(candidate).includes(q));
}

// ── The flat item list the FlatList renders ─────────────────────────────────
export type ChatListItemModel<C, F> =
  | { kind: "section"; key: string; section: "invites" | "chats" | "friends" | "events" }
  | { kind: "invite"; key: string; conversation: C }
  | { kind: "chat"; key: string; conversation: C }
  | { kind: "friend"; key: string; friend: F }
  | { kind: "archived"; key: string; count: number };

export function chatListItemHeight(kind: ChatListItemModel<unknown, unknown>["kind"]): number {
  switch (kind) {
    case "section":
      return CHAT_SECTION_LABEL_HEIGHT;
    case "archived":
      return CHAT_ARCHIVED_ROW_HEIGHT;
    case "invite":
    case "chat":
    case "friend":
      return CHAT_ROW_HEIGHT;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Browse mode: an "Invites" section (when there are any), then chats (pinned
 * first, then by activity) filtered by the chip, then one "Archived N" row at
 * the END of the list.
 */
export function buildBrowseItems<C extends ChatListConversationLike, F>(args: {
  active: readonly C[];
  archivedCount: number;
  filter: ChatFilter;
}): ChatListItemModel<C, F>[] {
  const invites = args.active.filter(isPendingInviteRow);
  const chats = sortChatList(args.active.filter((conversation) => !isPendingInviteRow(conversation)))
    .filter((conversation) => matchesChatFilter(conversation, args.filter));
  const items: ChatListItemModel<C, F>[] = [];
  if (invites.length > 0 && args.filter === "all") {
    items.push({ kind: "section", key: "section:invites", section: "invites" });
    for (const invite of invites) items.push({ kind: "invite", key: invite.id, conversation: invite });
    if (chats.length > 0) items.push({ kind: "section", key: "section:chats", section: "chats" });
  }
  for (const chat of chats) items.push({ kind: "chat", key: chat.id, conversation: chat });
  if (args.archivedCount > 0 && args.filter === "all") {
    items.push({ kind: "archived", key: "archived", count: args.archivedCount });
  }
  return items;
}

/**
 * Search mode: Chats (name and loaded text, as before), Friends you have not
 * chatted with yet, and event chats — each its own section, empty sections
 * left out.
 */
export function buildSearchItems<C extends ChatListConversationLike, F extends ChatListFriendLike>(args: {
  matchedChats: readonly C[];
  friends: readonly F[];
  allConversations: readonly C[];
  currentUserId: string;
  query: string;
}): ChatListItemModel<C, F>[] {
  const chats = sortChatList(args.matchedChats.filter((conversation) => chatKind(conversation) !== "event"));
  const events = sortChatList(args.matchedChats.filter((conversation) => chatKind(conversation) === "event"));
  const friends = friendsWithoutChat(args.friends, args.allConversations, args.currentUserId)
    .filter((friend) => friendMatches(friend, args.query));
  const items: ChatListItemModel<C, F>[] = [];
  if (chats.length > 0) {
    items.push({ kind: "section", key: "section:chats", section: "chats" });
    for (const chat of chats) {
      items.push({ kind: isPendingInviteRow(chat) ? "invite" : "chat", key: chat.id, conversation: chat });
    }
  }
  if (friends.length > 0) {
    items.push({ kind: "section", key: "section:friends", section: "friends" });
    for (const friend of friends) items.push({ kind: "friend", key: `friend:${friend.id}`, friend });
  }
  if (events.length > 0) {
    items.push({ kind: "section", key: "section:events", section: "events" });
    for (const event of events) items.push({ kind: "chat", key: event.id, conversation: event });
  }
  return items;
}

/** Offsets for FlatList getItemLayout (every item kind has a fixed height). */
export function chatListLayouts(items: readonly ChatListItemModel<unknown, unknown>[]): { length: number; offset: number }[] {
  let offset = 0;
  return items.map((item) => {
    const length = chatListItemHeight(item.kind);
    const layout = { length, offset };
    offset += length;
    return layout;
  });
}
