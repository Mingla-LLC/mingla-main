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
/** Gap between the glass header and the search field. */
export const CHAT_SEARCH_TOP_GAP = 8;
/** Filter chips row: 10pt top + 30pt chip + 6pt bottom (contract `.chips`). */
export const CHAT_FILTER_ROW_HEIGHT = 46;
export const CHAT_FILTER_CHIP_HEIGHT = 30;
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
  linked_entity_type?: "direct" | "session" | "trip" | "event" | "brand_enquiry" | "brand_guests";
  /** #4459: the brand of a brand Guest chat (linked_entity_type 'brand_guests'). */
  brand_id?: string | null;
  /** #4187 managed Mingla Local / Creator team conversation. */
  program_kind?: "local" | "creator" | null;
  participants: ChatListParticipant[];
  last_message?: {
    content?: string | null;
    created_at?: string | null;
    message_type?: string | null;
    /** Issue #4456: the last message was unsent ('sender' / 'admin' show the unsent line). */
    unsent_kind?: string | null;
    unsent_by?: string | null;
    /** #4459: 'brand' when the brand team posted (a brand Guest chat). */
    sender_kind?: string | null;
  } | null;
  unread_count?: number;
  pinned_at?: string | null;
  marked_unread_at?: string | null;
  /** Issue #4114 Wave 5: a 1:1 chat's live collab (list_connection_conversation_access). */
  live_session_id?: string | null;
  live_session_status?: string | null;
  __pendingInvite?: unknown;
  /** #4459: a Guest chat the brand removed this person from (no conversation row is readable). */
  __removedBrandGuests?: unknown;
  /** #4111 enquiry threads (D11): a private row of their own, never folded. */
  isEnquiry?: boolean;
  /**
   * #4630 (brand Guest chats): the later of my last booking with the brand and
   * the last message I can see (issue_4630_my_brand_chat_activity), and
   * whether that read succeeded. Never the chat's created_at.
   */
  brand_activity_at?: string | null;
  brand_activity_known?: boolean;
  /** #4630: my next booking with the brand (the empty row's preview). */
  next_booking_title?: string | null;
  next_booking_starts_at?: string | null;
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

export type ChatFilter = "all" | "unread" | "groups" | "brands";
export const CHAT_FILTERS: readonly ChatFilter[] = ["all", "unread", "groups", "brands"];

/**
 * Every kind of chat gets its own shape (design D12):
 *  - direct: a circle;
 *  - direct_collab: a circle with the orange deck badge (a 1:1 chat whose
 *    collab the friend has joined: live_session_status past pending);
 *  - group: two stacked circles plus the deck badge (every group is a collab);
 *  - event: a rounded-square cover (the retired per-listing event and trip
 *    chats; #4459 keeps the kind for any old row still in a cache);
 *  - brand_channel: the brand's rounded-square logo (#4459: the brand's one
 *    server-side Guest chat, linked_entity_type 'brand_guests', or the row of
 *    one the brand removed you from);
 *  - enquiry: #4111's private enquiry thread (D11), kept as its own row.
 */
export type ChatKind = "direct" | "direct_collab" | "group" | "event" | "brand_channel" | "enquiry" | "program";

export function chatKind(conversation: ChatListConversationLike): ChatKind {
  if (conversation.__removedBrandGuests) return "brand_channel";
  if (conversation.linked_entity_type === "brand_guests") return "brand_channel";
  if (conversation.isEnquiry) return "enquiry";
  if (conversation.program_kind) return "program";
  if (conversation.type === "group") {
    if (conversation.linked_entity_type === "event" || conversation.linked_entity_type === "trip") {
      return "event";
    }
    return "group";
  }
  // Issue #4114 Wave 5: a direct chat never carries session_id (the 1:1 rule);
  // its collab comes from collaboration_sessions.conversation_id via the access RPC.
  const status = conversation.live_session_status;
  if (conversation.live_session_id && (status === "active" || status === "voting" || status === "locked")) {
    return "direct_collab";
  }
  return "direct";
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
    case "brands":
      return chatKind(conversation) === "brand_channel";
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

/** #4459: a row Explorer renders as the brand's Guest chat. */
export function isBrandGuestsRow(conversation: ChatListConversationLike): boolean {
  return chatKind(conversation) === "brand_channel";
}

/** #4459: the row of a Guest chat the brand removed you from. */
export function isRemovedBrandGuestsRow(conversation: ChatListConversationLike): boolean {
  return Boolean(conversation.__removedBrandGuests);
}

/** #4459: the synthetic id of a Removed row (one per brand). */
export const REMOVED_BRAND_GUESTS_ID_PREFIX = "removed-brand-guests:";
export function removedBrandGuestsRowId(brandId: string): string {
  return `${REMOVED_BRAND_GUESTS_ID_PREFIX}${brandId}`;
}

// ── #4459: host chats (Explorer is the guest app) ──────────────────────────
/**
 * True for a host chat: the Guest chat of a brand this user is on the team of.
 * It is run from the Host app, so Explorer hides it everywhere (list, search,
 * filters, unread). Edge: a team member holding a guest ticket to their own
 * brand does not see it in Explorer either.
 *
 * `teamBrandIds` null means the user's teams are not known yet: nothing is hidden.
 */
export function isHostChatForUser(
  conversation: ChatListConversationLike,
  teamBrandIds: ReadonlySet<string> | null,
): boolean {
  if (teamBrandIds === null) return false;
  if (conversation.linked_entity_type !== "brand_guests") return false;
  return Boolean(conversation.brand_id) && teamBrandIds.has(conversation.brand_id as string);
}

/** Explorer's chats: everything but host chats (list, search, filters, archive). */
export function explorerConversations<C extends ChatListConversationLike>(
  conversations: readonly C[],
  teamBrandIds: ReadonlySet<string> | null,
): C[] {
  return conversations.filter((conversation) => !isHostChatForUser(conversation, teamBrandIds));
}

/**
 * Explorer's unread badge: host chats never count; muted chats never count.
 * A brand Guest chat counts its own unread_count (there is no fold to sum).
 */
export function explorerUnreadTotal<C extends ChatListConversationLike>(
  conversations: readonly C[],
  teamBrandIds: ReadonlySet<string> | null,
  isMuted: (conversation: C) => boolean = () => false,
): number {
  return explorerConversations(conversations, teamBrandIds).reduce(
    (sum, conversation) => sum + (isMuted(conversation) ? 0 : conversation.unread_count || 0),
    0,
  );
}

function isoTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** #4630: a brand Guest chat row (not a Removed one) is ordered by its brand activity. */
function isLiveBrandRow(conversation: ChatListConversationLike): boolean {
  return chatKind(conversation) === "brand_channel" && !isRemovedBrandGuestsRow(conversation);
}

/**
 * The one ordering time of a chat row (the list, search and the archived list).
 *
 * #4630: a brand Guest chat row is ordered by the later of its brand activity
 * (my last booking with the brand, the last message I can see) and its last
 * message, which a realtime message or my own send moves at once. When the
 * activity read failed it is the last message only, and an empty row is 0 (the
 * bottom). It is never the chat's created_at: every brand's chat was created
 * the day #4475 was applied, which put empty brand chats above real ones.
 * A Removed row keeps its removal time (created_at = removedAt). Every other
 * kind: last message, else created_at (unchanged).
 */
export function chatActivityTime(conversation: ChatListConversationLike): number {
  if (isLiveBrandRow(conversation)) {
    const last = isoTime(conversation.last_message?.created_at);
    if (!conversation.brand_activity_known) return last;
    return Math.max(isoTime(conversation.brand_activity_at), last);
  }
  return isoTime(conversation.last_message?.created_at || conversation.created_at);
}

/**
 * #4630: the time a row's label shows, so the label matches the order. A brand
 * row shows its activity time (null when it has none); every other row its
 * last message, as before.
 */
export function chatListTimeIso(conversation: ChatListConversationLike): string | null {
  if (isLiveBrandRow(conversation)) {
    const at = chatActivityTime(conversation);
    return at > 0 ? new Date(at).toISOString() : null;
  }
  return conversation.last_message?.created_at ?? null;
}

/** Pinned chats first (in the order they were pinned), then most recent activity. */
export function sortChatList<T extends ChatListConversationLike>(conversations: readonly T[]): T[] {
  const pinned = conversations
    .filter((conversation) => Boolean(conversation.pinned_at))
    .sort((a, b) => new Date(a.pinned_at as string).getTime() - new Date(b.pinned_at as string).getTime());
  const rest = conversations
    .filter((conversation) => !conversation.pinned_at)
    .sort((a, b) => chatActivityTime(b) - chatActivityTime(a));
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
  | { kind: "section"; key: string; section: "invites" | "chats" | "friends" | "brands" }
  | { kind: "invite"; key: string; conversation: C }
  | { kind: "chat"; key: string; conversation: C }
  /** #4111: an enquiry thread, always its own row (never folded, never an event). */
  | { kind: "enquiry"; key: string; conversation: C }
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
    case "enquiry":
    case "friend":
      return CHAT_ROW_HEIGHT;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** A chat or an enquiry row (enquiries keep their own row kind). */
function conversationItem<C extends ChatListConversationLike, F>(conversation: C): ChatListItemModel<C, F> {
  return chatKind(conversation) === "enquiry"
    ? { kind: "enquiry", key: `enquiry:${conversation.id}`, conversation }
    : { kind: "chat", key: conversation.id, conversation };
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
  for (const chat of chats) items.push(conversationItem<C, F>(chat));
  if (args.archivedCount > 0 && args.filter === "all") {
    items.push({ kind: "archived", key: "archived", count: args.archivedCount });
  }
  return items;
}

/**
 * Search mode: Chats (name and loaded text, as before), Friends you have not
 * chatted with yet, and brand Guest chats (#4459) — each its own section,
 * empty sections left out.
 */
export function buildSearchItems<C extends ChatListConversationLike, F extends ChatListFriendLike>(args: {
  matchedChats: readonly C[];
  friends: readonly F[];
  allConversations: readonly C[];
  currentUserId: string;
  query: string;
}): ChatListItemModel<C, F>[] {
  const chats = sortChatList(args.matchedChats.filter((conversation) => !isBrandGuestsRow(conversation)));
  const brands = sortChatList(args.matchedChats.filter(isBrandGuestsRow));
  const friends = friendsWithoutChat(args.friends, args.allConversations, args.currentUserId)
    .filter((friend) => friendMatches(friend, args.query));
  const items: ChatListItemModel<C, F>[] = [];
  if (chats.length > 0) {
    items.push({ kind: "section", key: "section:chats", section: "chats" });
    for (const chat of chats) {
      items.push(isPendingInviteRow(chat) ? { kind: "invite", key: chat.id, conversation: chat } : conversationItem<C, F>(chat));
    }
  }
  if (friends.length > 0) {
    items.push({ kind: "section", key: "section:friends", section: "friends" });
    for (const friend of friends) items.push({ kind: "friend", key: `friend:${friend.id}`, friend });
  }
  if (brands.length > 0) {
    items.push({ kind: "section", key: "section:brands", section: "brands" });
    for (const brand of brands) items.push({ kind: "chat", key: brand.id, conversation: brand });
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

// ── Avatars ─────────────────────────────────────────────────────────────────
/**
 * Issue #4114 — what each chat row's avatar shows.
 *
 *  - direct / direct_collab: the friend's profile photo, initials if none.
 *  - group: the other members' photos (never you): one circle for one other,
 *    two overlapping for two, a triangle for three, two plus "+N" for more.
 *  - event (team members' per-event rows): the event cover (never a video),
 *    then the brand logo, then initials, in a rounded square.
 *  - brand_channel: the brand logo, then the brand's initials (#4459 Guest chat).
 *  - enquiry (#4111): the brand logo when the row carries one, else the person.
 *
 * Only stored URLs are used (no image transformations: the spend cap is armed).
 */
export interface AvatarPersonInput {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface ChatAvatarSpec {
  shape: "circle" | "group" | "square";
  /** People in the circle or cluster, at most 3, never the current user. */
  people: AvatarPersonInput[];
  /** Images for the rounded square, tried in order before the initials. */
  coverUrls: string[];
  /** Members beyond the two shown, drawn as a "+N" bubble (group only). */
  extraCount: number;
  label: string;
}

export interface ChatAvatarInput {
  kind: ChatKind;
  currentUserId: string;
  /** Display label: the friend's, group's, event's or brand's name. */
  label: string;
  participants: readonly AvatarPersonInput[];
  /** brand_channel: the brand's logo. */
  brandLogoUrl?: string | null;
  /** event: its cover and its brand's logo. */
  eventCoverUrl?: string | null;
  eventCoverMediaType?: string | null;
  eventBrandLogoUrl?: string | null;
}

/** Most members shown as photos before the rest collapse into "+N". */
const GROUP_PHOTOS_BEFORE_OVERFLOW = 2;
const GROUP_MAX_FACES = 3;

function present(url: string | null | undefined): url is string {
  return typeof url === "string" && url.trim().length > 0;
}

function uniqueUrls(urls: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const url of urls) {
    if (present(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

function square(label: string, urls: readonly (string | null | undefined)[]): ChatAvatarSpec {
  return { shape: "square", people: [], coverUrls: uniqueUrls(urls), extraCount: 0, label };
}

function circle(label: string, person: AvatarPersonInput | undefined): ChatAvatarSpec {
  return {
    shape: "circle",
    people: [person ?? { id: "person", name: label }],
    coverUrls: [],
    extraCount: 0,
    label,
  };
}

export function chatAvatarSpec(input: ChatAvatarInput): ChatAvatarSpec {
  const others = input.participants.filter((person) => person.id !== input.currentUserId);
  switch (input.kind) {
    case "brand_channel":
      return square(input.label, [input.brandLogoUrl]);
    case "event":
      return square(input.label, [
        input.eventCoverMediaType === "video" ? null : input.eventCoverUrl,
        input.eventBrandLogoUrl,
      ]);
    case "enquiry":
      return present(input.eventBrandLogoUrl ?? input.brandLogoUrl)
        ? square(input.label, [input.eventBrandLogoUrl, input.brandLogoUrl])
        : circle(input.label, others[0]);
    case "program":
      return square(input.label, []);
    case "group": {
      if (others.length <= 1) return circle(input.label, others[0]);
      if (others.length <= GROUP_MAX_FACES) {
        return { shape: "group", people: others.slice(0, GROUP_MAX_FACES), coverUrls: [], extraCount: 0, label: input.label };
      }
      return {
        shape: "group",
        people: others.slice(0, GROUP_PHOTOS_BEFORE_OVERFLOW),
        coverUrls: [],
        extraCount: others.length - GROUP_PHOTOS_BEFORE_OVERFLOW,
        label: input.label,
      };
    }
    case "direct":
    case "direct_collab":
      return circle(input.label, others[0]);
    default: {
      const exhaustive: never = input.kind;
      return exhaustive;
    }
  }
}

// ── Issue #4261: the last-message preview text ─────────────────────────────
export interface ChatPreviewMessageLike {
  content?: string | null;
  message_type?: string | null;
  card_payload?: unknown;
}

export type ChatPreviewTranslate = (key: string, params?: Record<string, unknown>) => string;

function planTitleOf(message: ChatPreviewMessageLike): string {
  const content = (message.content ?? "").replace(/\s+/g, " ").trim();
  // The plan message's content is "<first name> added a plan: <title>".
  const marker = " added a plan: ";
  const at = content.indexOf(marker);
  return at >= 0 ? content.slice(at + marker.length).trim() : content;
}

/**
 * The chat list's preview of a last message. Photos, videos and files keep
 * their labels; a plan reads "Plan: {title}"; a plan or group system row
 * (`plan_event` / `group_event`) reads its own content; everything else is the
 * message text on one line.
 */
export function chatPreviewText(message: ChatPreviewMessageLike | null | undefined, t: ChatPreviewTranslate): string {
  if (!message) return "";
  switch (message.message_type) {
    case "image":
      return t("chat:photoPreview");
    case "file":
      return t("chat:filePreview");
    case "video":
      return t("chat:videoPreview");
    case "plan": {
      const title = planTitleOf(message);
      return title ? t("chat:plan_preview", { title }) : t("chat:plan_chip");
    }
    default:
      return (message.content ?? "").replace(/\s+/g, " ").trim();
  }
}

// ── Issue #4261 amendment 1 (B-3): the preview line with its sender prefix ──
export interface ChatPreviewLineMessage {
  sender_id?: string | null;
  sender_name?: string | null;
  message_type?: string | null;
  marketing_campaign_id?: string | null;
  /** #4459: 'brand' when the brand team posted in a Guest chat. */
  sender_kind?: string | null;
}

/** A system row (plan / group events, joins): written by Mingla, never by a person. */
export function isSystemPreviewRow(message: ChatPreviewLineMessage): boolean {
  // #4459: a brand post in a Guest chat stores no sender but is not a system row.
  if (message.message_type === "system") return true;
  return message.sender_id == null && message.sender_kind !== "brand";
}

/**
 * The chat list's preview line from the preview text (`chatPreviewText`):
 * "You: …" for my own message, "{sender}: …" in a group (the brand's name for
 * a brand message in an event chat or a brand Guest chat, #4459). A system row
 * is never prefixed (it used to read "Deleted User: Seth locked in …", because
 * a system row has no sender).
 */
export function chatPreviewLine(input: {
  message: ChatPreviewLineMessage;
  text: string;
  isGroup: boolean;
  isEvent: boolean;
  /** #4459: a brand Guest chat (a brand post is credited to the brand). */
  isBrandChannel: boolean;
  currentUserId: string | null | undefined;
  eventBrandName?: string | null;
  eventBrandAccountId?: string | null;
  t: ChatPreviewTranslate;
}): string {
  const { message, text, t } = input;
  const system = isSystemPreviewRow(message);
  const mine = !system && !!message.sender_id && message.sender_id === input.currentUserId;
  if (system) return text;
  if (mine) return t("connections:preview_you", { text });
  if (input.isBrandChannel) {
    const brandName = input.eventBrandName?.trim();
    if (message.sender_kind === "brand" && brandName) return `${brandName}: ${text}`;
    return message.sender_name ? `${message.sender_name}: ${text}` : text;
  }
  if (input.isGroup && message.sender_name) {
    const brandName = input.eventBrandName?.trim();
    const fromBrand = input.isEvent && !!brandName && (
      !!message.marketing_campaign_id ||
      (!!input.eventBrandAccountId && message.sender_id === input.eventBrandAccountId)
    );
    return `${fromBrand ? brandName : message.sender_name}: ${text}`;
  }
  return text;
}

// ── Issue #4456: an unsent last message ────────────────────────────────────
export interface ChatTombstonePreviewMessage {
  sender_id?: string | null;
  sender_name?: string | null;
  unsent_kind?: string | null;
  unsent_by?: string | null;
}

/**
 * The Chats list line for an unsent last message, the same line as the thread
 * ("You unsent a message", "Ana unsent a message", "Sam removed a message",
 * "Sam removed your message"), with no "Ana:" prefix (the line names her).
 * Null when the last message is not an unsent line. The row renders it in
 * italics, never bold, and it never counts as unread (the server's unread
 * count skips removed messages).
 */
export function chatTombstonePreview(input: {
  message: ChatTombstonePreviewMessage | null | undefined;
  currentUserId: string | null | undefined;
  nameOf: (userId: string) => string | null;
  t: ChatPreviewTranslate;
  /** #4459: the brand of a Guest chat ("Message removed by <Brand>"). */
  brandName?: string | null;
}): string | null {
  const message = input.message;
  if (message?.unsent_kind === "host") {
    const brand = (input.brandName ?? "").trim();
    return brand ? input.t("chat:tombstoneHostRemoved", { name: brand }) : input.t("chat:tombstoneHostRemovedGeneric");
  }
  if (!message || (message.unsent_kind !== "sender" && message.unsent_kind !== "admin")) return null;
  const firstName = (name: string | null | undefined): string =>
    (name ?? "").trim().split(/\s+/)[0] || input.t("chat:someone");
  const authorIsMe = !!message.sender_id && message.sender_id === input.currentUserId;
  const actorIsMe = !!message.unsent_by && message.unsent_by === input.currentUserId;
  if (message.unsent_kind === "admin") {
    if (actorIsMe) return input.t("chat:tombstoneYouRemoved");
    const actor = firstName(message.unsent_by ? input.nameOf(message.unsent_by) : null);
    return authorIsMe
      ? input.t("chat:tombstoneAdminRemovedYours", { name: actor })
      : input.t("chat:tombstoneAdminRemoved", { name: actor });
  }
  if (authorIsMe) return input.t("chat:tombstoneYouUnsent");
  const author = message.sender_name || (message.sender_id ? input.nameOf(message.sender_id) : null);
  return input.t("chat:tombstoneTheyUnsent", { name: firstName(author) });
}
