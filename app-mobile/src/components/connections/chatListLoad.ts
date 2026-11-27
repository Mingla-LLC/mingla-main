/**
 * Issue #4265 — the Chats tab list, loaded in as few round trips as possible.
 *
 * The Chats tab used to start empty on every visit (the list lived in
 * ConnectionsPage local state) and then ran a chain of reads one after the
 * other: AsyncStorage → conversations + unread → sender profiles → sessions /
 * phone invites / event meta / brand teams → participant profiles → pending
 * session invites. That took 1.7–1.9 s on every visit.
 *
 * Now the list is ONE React Query entry (useChatList → chatListKeys.list) and
 * this loader runs the reads in two waves:
 *   wave 1 (nothing needs ids): conversations + unread, pending session
 *          invites, your brand team rows, your brand chat activity (#4630)
 *          — all at once;
 *   wave 2 (needs conversation ids): sessions (name, creator, status), event
 *          meta and ONE profiles read (participants ∪ last-message senders ∪
 *          inviters) — all at once.
 * #4435 leftovers: the session phone-invite read and the follow-up profiles
 * read for session people were removed; no row rendered either.
 *
 * Pure and dependency-free (every read is injected) so it runs under Deno.
 */

/** How long a loaded list is fresh: revisits inside this window do not refetch. */
export const CHAT_LIST_STALE_TIME_MS = 30_000;
/** The conversations read gives up after this long (background-suspended sockets can hang). */
export const CHAT_LIST_TIMEOUT_MS = 10_000;
/**
 * The same read with no list to show. Incident reads took 14-18 s, so a 10 s
 * attempt could never win; 20 s matches the global fetch timeout.
 */
export const CHAT_LIST_FIRST_LOAD_TIMEOUT_MS = 20_000;
/** Retries, after the first attempt, while there is no list to show. */
export const CHAT_LIST_FIRST_LOAD_RETRIES = 4;
const CHAT_LIST_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000, 16000];
const CHAT_LIST_RETRY_JITTER = 0.2;

/** How long this attempt may wait for the conversations read. */
export function chatListAttemptTimeoutMs(hasCachedList: boolean): number {
  return hasCachedList ? CHAT_LIST_TIMEOUT_MS : CHAT_LIST_FIRST_LOAD_TIMEOUT_MS;
}

/** 2, 4, 8, 16 s with +/-20% jitter, for loads with no cached list. */
export function chatListRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = CHAT_LIST_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), CHAT_LIST_RETRY_DELAYS_MS.length - 1)];
  return base * (1 - CHAT_LIST_RETRY_JITTER + random() * CHAT_LIST_RETRY_JITTER * 2);
}

/**
 * With no list to show, keep trying, timeouts included: a failure here would
 * otherwise leave the person with nothing. With a cached list on screen a
 * timeout already waited 10 s and the next visit or pull-to-refresh retries.
 */
export function shouldRetryChatList(
  failureCount: number,
  error: unknown,
  hasCachedList: boolean,
  isFatal: boolean,
): boolean {
  if (isFatal) return false;
  if (!hasCachedList) return failureCount < CHAT_LIST_FIRST_LOAD_RETRIES;
  return !isChatListTimeout(error) && failureCount < 1;
}

// ── Unread counts ────────────────────────────────────────────────────────
//
// Same rule as before: a message counts as unread for me when someone else
// (or the system, sender_id NULL) sent it, it is not deleted, and I have no
// message_reads row for it. The old read downloaded EVERY such message with
// EVERY read receipt and counted on the phone. This read asks the server for
// only the messages I have not read (PostgREST anti-join: the embed is
// filtered to my reads, then `message_reads=is.null` keeps the rows with none),
// and returns just their conversation ids.

/** Select for the unread read: the empty embed exists only for the anti-join. */
// Typed `string` on purpose: supabase-js parses literal select strings at the
// type level and does not understand an empty embed (tsc recursion limit).
export const UNREAD_MESSAGES_SELECT: string = "conversation_id, message_reads()";

/**
 * The three filter calls the unread read needs, passed in by the caller so
 * this module stays free of supabase-js (its filter-builder generics are too
 * deep to match against a structural interface).
 */
export type UnreadFilterOps<Q> = {
  or(query: Q, filters: string): Q;
  isNull(query: Q, column: string): Q;
  eq(query: Q, column: string, value: string): Q;
};

/** Applies the unread rule to a `messages` read selected with UNREAD_MESSAGES_SELECT. */
export function applyUnreadFilters<Q>(query: Q, userId: string, ops: UnreadFilterOps<Q>): Q {
  let next = ops.or(query, `sender_id.neq.${userId},sender_id.is.null`);
  next = ops.isNull(next, "deleted_at");
  // Embedded filter: narrows message_reads to MY reads (never the messages)…
  next = ops.eq(next, "message_reads.user_id", userId);
  // …then keeps only messages with none of them (anti-join).
  return ops.isNull(next, "message_reads");
}

/** Counts unread rows per conversation. */
export function countUnreadRows(rows: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  if (!Array.isArray(rows)) return counts;
  for (const row of rows) {
    const conversationId = row && typeof row === "object" ? (row as { conversation_id?: unknown }).conversation_id : null;
    if (typeof conversationId !== "string" || conversationId.length === 0) continue;
    counts.set(conversationId, (counts.get(conversationId) ?? 0) + 1);
  }
  return counts;
}

// ── Types (structural; ConnectionsPage owns the app-facing types) ─────────

export type ChatListProfile = {
  id: string;
  display_name?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
};

export type ChatListLinkedEntity = "direct" | "session" | "trip" | "event" | "brand_guests";

export type RawChatLastMessage = {
  sender_id?: string | null;
  sender_display_name_snapshot?: string | null;
  sender_name?: string;
  [field: string]: unknown;
};

export type RawChatConversation = {
  id: string;
  type?: "direct" | "group";
  name?: string | null;
  session_id?: string | null;
  event_id?: string | null;
  linked_entity_type?: ChatListLinkedEntity;
  /** #4459: set on a brand Guest chat. */
  brand_id?: string | null;
  program_kind?: "local" | "creator" | null;
  is_broadcast_only?: boolean;
  created_by?: string | null;
  created_at: string;
  participants: ReadonlyArray<{ user_id: string }>;
  last_message?: RawChatLastMessage;
  unread_count?: number;
  archived_at?: string | null;
  pinned_at?: string | null;
  marked_unread_at?: string | null;
  live_session_id?: string | null;
  live_session_status?: string | null;
};

/** What a group row shows from its session: the name fallback, the creator and the status. */
export type ChatSessionRow = {
  id: string;
  name: string | null;
  created_by: string | null;
  status?: string | null;
};

export type RawPendingSessionInvite = {
  id: string;
  session_id: string;
  inviter_id: string | null;
  created_at: string;
};

export type ChatEventPublicCard = {
  publicBuyerUrl?: string;
  nextStartAtUtc?: string | null;
  masterDateUtc?: string | null;
  nextEndAtUtc?: string | null;
  masterEndAtUtc?: string | null;
};

export type ChatEventMeta<TCard extends ChatEventPublicCard = ChatEventPublicCard> = {
  title: string | null;
  slug: string | null;
  brandId: string | null;
  brandName: string | null;
  brandSlug: string | null;
  brandAccountId: string | null;
  coverMediaUrl: string | null;
  brandLogoUrl?: string | null;
  publicCard: TCard | null;
};

/** #4459: the brand behind a Guest chat row. */
export type ChatBrandMeta = {
  brandId: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  accountId: string | null;
};

/** #4459: a Guest chat the brand removed this person from (its own "Removed" row). */
export type ChatRemovedBrandGuests = {
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  brandAccountId: string | null;
  removedAt: string;
};

/**
 * #4630: my times in one brand Guest chat (issue_4630_my_brand_chat_activity).
 * The Chats list orders a brand row by the later of my last booking with the
 * brand and the last message I can see there, never by the chat's creation.
 */
export type ChatBrandActivity = {
  conversationId: string;
  myLastBookingAt: string | null;
  lastVisibleMessageAt: string | null;
  nextBookingTitle: string | null;
  nextBookingStartsAt: string | null;
};

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/** Reads the activity RPC's rows; malformed rows are dropped. */
export function parseBrandChatActivityRows(rows: unknown): ChatBrandActivity[] {
  if (!Array.isArray(rows)) return [];
  const out: ChatBrandActivity[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.conversation_id !== "string" || r.conversation_id.length === 0) continue;
    out.push({
      conversationId: r.conversation_id,
      myLastBookingAt: isoOrNull(r.my_last_booking_at),
      lastVisibleMessageAt: isoOrNull(r.last_visible_message_at),
      nextBookingTitle: typeof r.next_booking_title === "string" && r.next_booking_title.trim() ? r.next_booking_title : null,
      nextBookingStartsAt: isoOrNull(r.next_booking_starts_at),
    });
  }
  return out;
}

/** The later of my last booking and the last visible message, or null. */
export function brandActivityAt(activity: ChatBrandActivity | undefined): string | null {
  if (!activity) return null;
  const booking = activity.myLastBookingAt ? new Date(activity.myLastBookingAt).getTime() : -Infinity;
  const message = activity.lastVisibleMessageAt ? new Date(activity.lastVisibleMessageAt).getTime() : -Infinity;
  if (booking === -Infinity && message === -Infinity) return null;
  return booking >= message ? activity.myLastBookingAt : activity.lastVisibleMessageAt;
}

export type ChatListPendingInvite = {
  sessionId: string;
  inviteId: string;
  inviterDisplayName: string;
  inviterAvatarUrl: string | null;
  createdAt: string;
};

/** One list row, in the shape ChatListItem reads (cast to Conversation by the caller). */
export type ChatListConversation = {
  id: string;
  created_by: string;
  created_at: string;
  participants: Array<{
    id: string;
    username: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    avatar_url?: string | null;
  }>;
  last_message?: RawChatLastMessage;
  unread_count: number;
  messages: never[];
  type?: "direct" | "group";
  name?: string | null;
  session_id?: string | null;
  event_id?: string | null;
  linked_entity_type?: ChatListLinkedEntity;
  [field: string]: unknown;
};

export type ChatListData = {
  conversations: ChatListConversation[];
  /** Brands this user is on the team of; null when the read failed (keep the last known set). */
  teamBrandIds: string[] | null;
};

export type ChatListLoadDeps<TCard extends ChatEventPublicCard = ChatEventPublicCard> = {
  /** Conversations + unread counts. Must not fetch sender profiles (the loader does, once). */
  getConversations(userId: string): Promise<{ conversations: RawChatConversation[]; error: string | null }>;
  /** Pending collab invites sent to me. A failure hides them (logged), it never fails the list. */
  fetchPendingInvites(userId: string): Promise<RawPendingSessionInvite[]>;
  /** My accepted brand team rows; null when the read failed. */
  fetchTeamBrandIds(userId: string): Promise<string[] | null>;
  fetchSessions(sessionIds: string[]): Promise<ChatSessionRow[]>;
  fetchEventMeta(eventIds: string[]): Promise<Map<string, ChatEventMeta<TCard>>>;
  /** #4459: the brands of the Guest chat rows. A failure keeps the rows (named from the chat). */
  fetchBrandMeta(brandIds: string[]): Promise<Map<string, ChatBrandMeta>>;
  /** #4459: Guest chats the brand removed me from. A failure hides them (logged), never the list. */
  fetchRemovedBrandGuestChats(userId: string): Promise<ChatRemovedBrandGuests[]>;
  /**
   * #4630: my activity per brand Guest chat. Rejects on a failed read: the
   * list still loads (logged), and brand rows then order by their last message
   * only (an empty one sinks to the bottom), never by the chat's creation.
   */
  fetchBrandChatActivity(): Promise<ChatBrandActivity[]>;
  fetchProfiles(userIds: string[]): Promise<ChatListProfile[]>;
  displayName(profile: ChatListProfile | undefined, fallback?: string): string;
  eventPublicUrl(meta: ChatEventMeta<TCard> | null | undefined, linkedEntityType: ChatListLinkedEntity | undefined): string | null;
  /** Warms the messaging service's sender-name cache from the one profiles read. */
  rememberSenderProfiles?(profiles: ChatListProfile[]): void;
  warn(message: string, error: unknown): void;
  timeoutMs?: number;
  /** Injected for tests; defaults to setTimeout/clearTimeout. */
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
};

export class ChatListTimeoutError extends Error {
  constructor() {
    super("getConversations timed out");
    this.name = "TimeoutError";
  }
}

export function isChatListTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "TimeoutError");
}

type ChatListTimer = Pick<ChatListLoadDeps, "timeoutMs" | "setTimer" | "clearTimer">;

function withChatListTimeout<T>(promise: Promise<T>, deps: ChatListTimer): Promise<T> {
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimer(() => reject(new ChatListTimeoutError()), deps.timeoutMs ?? CHAT_LIST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimer(handle));
}

/** Loads every row of the Chats list. Throws on a failed conversations / sessions / profiles read. */
export async function loadChatList<TCard extends ChatEventPublicCard>(
  userId: string,
  deps: ChatListLoadDeps<TCard>,
): Promise<ChatListData> {
  // ── Wave 1: everything that does not need conversation ids ──
  const conversationsPromise = withChatListTimeout(deps.getConversations(userId), deps);
  const invitesPromise = deps.fetchPendingInvites(userId).catch((error: unknown) => {
    deps.warn("[ConnectionsPage] Failed to fetch pending session invites:", error);
    return [] as RawPendingSessionInvite[];
  });
  const removedPromise = deps.fetchRemovedBrandGuestChats(userId).catch((error: unknown) => {
    deps.warn("[ConnectionsPage] removed Guest chats read failed:", error);
    return [] as ChatRemovedBrandGuests[];
  });
  // #4630: one read, started with the conversations read (no extra round trip).
  // null = unknown (the read failed): brand rows then order by their last message only.
  const brandActivityPromise: Promise<Map<string, ChatBrandActivity> | null> = Promise.resolve()
    .then(() => deps.fetchBrandChatActivity())
    .then((rows) => new Map(rows.map((row) => [row.conversationId, row])))
    .catch((error: unknown) => {
      deps.warn("[ConnectionsPage] brand chat activity read failed; brand rows order by their last message", error);
      return null;
    });
  const teamsPromise = deps.fetchTeamBrandIds(userId).catch((error: unknown) => {
    deps.warn("[ConnectionsPage] brand team read failed; keeping the last known teams", error);
    return null;
  });

  const { conversations: rawConversations, error: convError } = await conversationsPromise;
  if (convError) throw new Error(convError);
  const raw = rawConversations ?? [];

  const firstProfileIds = new Set<string>();
  const groupSessionIds = new Set<string>();
  const groupEventIds = new Set<string>();
  const guestChatBrandIds = new Set<string>();
  const senderIds = new Set<string>();
  for (const conv of raw) {
    conv.participants.forEach((participant) => firstProfileIds.add(participant.user_id));
    const senderId = conv.last_message?.sender_id;
    if (senderId) {
      senderIds.add(senderId);
      firstProfileIds.add(senderId);
    }
    if (conv.type === "group" && conv.session_id) groupSessionIds.add(conv.session_id);
    if (
      conv.type === "group" && conv.event_id &&
      (conv.linked_entity_type === "trip" || conv.linked_entity_type === "event")
    ) {
      groupEventIds.add(conv.event_id);
    }
    if (conv.linked_entity_type === "brand_guests" && conv.brand_id) guestChatBrandIds.add(conv.brand_id);
  }

  // Inviter profiles ride on the same profiles read. The invites read started
  // with the conversations read, so it is normally done already.
  const rawInvites = await invitesPromise;
  for (const invite of rawInvites) {
    if (invite.inviter_id) firstProfileIds.add(invite.inviter_id);
  }

  // ── Wave 2: everything that needs conversation ids, at once ──
  const sessionIdList = Array.from(groupSessionIds);
  const [sessions, eventMetaMap, firstProfiles, teamRows, brandMetaMap, removedChats, brandActivity] = await Promise.all([
    sessionIdList.length > 0 ? deps.fetchSessions(sessionIdList) : Promise.resolve([] as ChatSessionRow[]),
    deps.fetchEventMeta(Array.from(groupEventIds)).catch((error: unknown) => {
      deps.warn("[ConnectionsPage] Failed to batch-resolve group chat event metadata:", error);
      return new Map<string, ChatEventMeta<TCard>>();
    }),
    firstProfileIds.size > 0 ? deps.fetchProfiles(Array.from(firstProfileIds)) : Promise.resolve([] as ChatListProfile[]),
    // With no brand Guest chats there is nothing to hide: the team set is empty.
    groupEventIds.size > 0 || guestChatBrandIds.size > 0 ? teamsPromise : teamsPromise.then(() => [] as string[]),
    deps.fetchBrandMeta(Array.from(guestChatBrandIds)).catch((error: unknown) => {
      deps.warn("[ConnectionsPage] Failed to resolve Guest chat brands:", error);
      return new Map<string, ChatBrandMeta>();
    }),
    removedPromise,
    brandActivityPromise,
  ]);

  const profilesMap = new Map<string, ChatListProfile>(firstProfiles.map((profile) => [profile.id, profile]));

  const senderProfiles = Array.from(senderIds)
    .map((id) => profilesMap.get(id))
    .filter((profile): profile is ChatListProfile => Boolean(profile));
  if (senderProfiles.length > 0) deps.rememberSenderProfiles?.(senderProfiles);

  let teamBrandIds: string[] | null = null;
  if (teamRows !== null) {
    // The brand's owner is on its team too (owner trigger); account_id is a belt and braces.
    const owned = [
      ...Array.from(eventMetaMap.values())
        .filter((meta) => meta.brandId && meta.brandAccountId === userId)
        .map((meta) => meta.brandId as string),
      ...Array.from(brandMetaMap.values())
        .filter((meta) => meta.accountId === userId)
        .map((meta) => meta.brandId),
    ];
    teamBrandIds = Array.from(new Set([...teamRows, ...owned])).sort();
  }

  const sessionMetaMap = new Map(
    sessions.map((session) => [
      session.id,
      { name: session.name, created_by: session.created_by, status: session.status ?? null },
    ]),
  );

  // Transform to the ChatListItem shape. ORCH-0898: `type`, `name`,
  // `session_id` pass through for the group-vs-direct render branch.
  const transformed: ChatListConversation[] = raw.map((conv) => {
    const participants = conv.participants.map((p) => {
      const profile = profilesMap.get(p.user_id);
      return {
        id: p.user_id,
        username: profile?.username || "unknown",
        display_name: profile?.display_name,
        first_name: profile?.first_name,
        last_name: profile?.last_name,
        avatar_url: profile?.avatar_url,
        // Issue #4114: no hard-coded presence. The only presence data is
        // per-conversation "has this chat open" (conversation_presence),
        // which is not app-wide online state, so the list shows no dot.
      };
    });

    // The sender name the old second profiles read used to supply: the
    // snapshot first, then the profile from the one read, else what the
    // messaging service already resolved.
    let lastMessage = conv.last_message;
    if (lastMessage && !lastMessage.sender_display_name_snapshot && lastMessage.sender_id) {
      const senderProfile = profilesMap.get(lastMessage.sender_id);
      if (senderProfile) lastMessage = { ...lastMessage, sender_name: deps.displayName(senderProfile, "Unknown") };
    }

    const sessionId = conv.session_id ?? null;
    const eventId = conv.event_id ?? null;
    const linkedEntityType = conv.linked_entity_type;
    const programKind = conv.program_kind ?? null;
    const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : null;
    const eventMeta = eventId ? eventMetaMap.get(eventId) : null;
    // #4459: a brand Guest chat shows its brand (name, logo, page).
    const brandId = linkedEntityType === "brand_guests" ? conv.brand_id ?? null : null;
    const brandMeta = brandId ? brandMetaMap.get(brandId) ?? null : null;
    const eventPublicUrl = deps.eventPublicUrl(eventMeta, linkedEntityType);
    const eventPublicCard = eventMeta?.publicCard
      ? {
          ...eventMeta.publicCard,
          publicBuyerUrl: eventPublicUrl ?? eventMeta.publicCard.publicBuyerUrl,
        }
      : null;
    // #4630: a Guest chat's own times (my last booking, the last visible
    // message) and my next booking with the brand.
    const activity = linkedEntityType === "brand_guests" ? brandActivity?.get(conv.id) : undefined;
    const brandActivityFields = linkedEntityType === "brand_guests"
      ? {
          brand_activity_at: brandActivityAt(activity),
          brand_activity_known: brandActivity !== null,
          next_booking_title: activity?.nextBookingTitle ?? null,
          next_booking_starts_at: activity?.nextBookingStartsAt ?? null,
        }
      : {};
    const conversationName = brandMeta?.name?.trim()
      || eventMeta?.title?.trim()
      || conv.name?.trim()
      || sessionMeta?.name?.trim()
      || null;
    return {
      id: conv.id,
      created_by: conv.created_by ?? "",
      created_at: conv.created_at,
      participants,
      last_message: lastMessage,
      unread_count: conv.unread_count || 0,
      messages: [],
      // ORCH-0898 group-chat extras (consumed by ChatListItem):
      type: conv.type,
      name: conversationName,
      session_id: sessionId,
      event_id: eventId,
      linked_entity_type: linkedEntityType ?? undefined,
      brand_id: brandId,
      program_kind: programKind,
      sessionCreatorId: sessionMeta?.created_by ?? null,
      sessionStatus: sessionMeta?.status ?? null,
      is_broadcast_only: Boolean(conv.is_broadcast_only),
      eventBrandName: brandMeta?.name ?? (brandId ? conv.name ?? null : null) ?? eventMeta?.brandName ?? null,
      eventBrandAccountId: brandMeta?.accountId ?? eventMeta?.brandAccountId ?? null,
      // #4459: the brand of a Guest chat (or of a retired event row).
      eventBrandId: brandId ?? eventMeta?.brandId ?? null,
      eventBrandSlug: brandMeta?.slug ?? eventMeta?.brandSlug ?? null,
      eventBrandLogoUrl: brandMeta?.logoUrl ?? eventMeta?.brandLogoUrl ?? null,
      eventStartAt:
        eventMeta?.publicCard?.nextStartAtUtc ??
        eventMeta?.publicCard?.masterDateUtc ??
        null,
      eventEndAt:
        eventMeta?.publicCard?.nextEndAtUtc ??
        eventMeta?.publicCard?.masterEndAtUtc ??
        null,
      eventCoverMediaUrl: eventMeta?.coverMediaUrl ?? null,
      eventPublicUrl,
      eventPublicCard,
      archived_at: conv.archived_at ?? null,
      pinned_at: conv.pinned_at ?? null,
      marked_unread_at: conv.marked_unread_at ?? null,
      // Issue #4114 Wave 5: the 1:1 chat's live collab (from the access RPC).
      live_session_id: conv.live_session_id ?? null,
      live_session_status: conv.live_session_status ?? null,
      ...brandActivityFields,
    };
  });

  const pendingInviteRows: ChatListConversation[] = rawInvites.map((invite) => {
    const profile = invite.inviter_id ? profilesMap.get(invite.inviter_id) : undefined;
    const pendingInvite: ChatListPendingInvite = {
      sessionId: invite.session_id,
      inviteId: invite.id,
      inviterDisplayName: deps.displayName(profile),
      inviterAvatarUrl: profile?.avatar_url ?? null,
      createdAt: invite.created_at,
    };
    return {
      id: `pending-invite-${invite.id}`,
      created_by: "",
      created_at: invite.created_at,
      participants: [],
      unread_count: 0,
      messages: [],
      type: "group" as const,
      name: pendingInvite.inviterDisplayName,
      session_id: invite.session_id,
      linked_entity_type: "session" as const,
      __pendingInvite: pendingInvite,
    };
  });

  // #4459: the Guest chats the brand removed me from, each as its own row (no
  // conversation is readable after a removal). A brand I am on the team of
  // never shows one.
  const teamSet = new Set(teamBrandIds ?? []);
  const removedRows: ChatListConversation[] = removedChats
    .filter((removed) => !teamSet.has(removed.brandId))
    .map((removed) => ({
      id: `removed-brand-guests:${removed.brandId}`,
      created_by: "",
      created_at: removed.removedAt,
      participants: [],
      unread_count: 0,
      messages: [],
      type: "group" as const,
      name: removed.brandName,
      linked_entity_type: "brand_guests" as const,
      brand_id: removed.brandId,
      eventBrandId: removed.brandId,
      eventBrandName: removed.brandName,
      eventBrandSlug: removed.brandSlug,
      eventBrandLogoUrl: removed.brandLogoUrl,
      eventBrandAccountId: removed.brandAccountId,
      __removedBrandGuests: removed,
    }));

  return { conversations: [...pendingInviteRows, ...transformed, ...removedRows], teamBrandIds };
}

// ── Cache writes ─────────────────────────────────────────────────────────

/** The two QueryClient methods the list's local writes need. */
export interface ChatListCache {
  getQueryData(queryKey: readonly unknown[]): unknown;
  setQueryData(queryKey: readonly unknown[], updater: (old: unknown) => unknown): unknown;
}

/**
 * The ONE write path for every local change to the list (archive, delete,
 * mark read, realtime message, optimistic send, pin…). Writes into the React
 * Query entry, so there is no second copy of the list. Before the first load
 * finishes there is nothing to patch: the write is dropped and the load (which
 * is in flight) brings the server truth.
 */
export function updateChatListConversations<T>(
  cache: ChatListCache,
  queryKey: readonly unknown[],
  updater: (current: T[]) => T[],
): void {
  cache.setQueryData(queryKey, (old: unknown) => {
    const data = old as { conversations?: T[] } | undefined;
    if (!data || !Array.isArray(data.conversations)) return old;
    return { ...data, conversations: updater(data.conversations) };
  });
}

/** Archived chat ids, read from the list itself (the archive action patches `archived_at`). */
export function archivedConversationIds(
  conversations: ReadonlyArray<{ id: string; archived_at?: unknown }>,
): Set<string> {
  return new Set(conversations.filter((conversation) => Boolean(conversation.archived_at)).map((conversation) => conversation.id));
}

// ── What the page shows for the query's state ─────────────────────────────

export type ChatListQueryState = {
  data: ChatListData | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** Failed attempts of the fetch in progress; React Query resets it when a fetch starts. */
  failureCount?: number;
};

/**
 * Cached rows render at once, also while a background refresh runs; the
 * skeleton shows only when there is no list yet (the first-ever visit). A
 * failed refresh shows the error row only once it has settled. A timeout over
 * cached rows stays silent (expected after the app was in the background); a
 * timeout with no rows is a failure, because nothing else is on screen and a cached
 * empty list cannot say the person has no chats right now.
 *
 * invariant: I-CHAT-LIST-EMPTY-MEANS-SERVER-EMPTY — the empty state requires a
 * loaded list. Enforced by issue_4275_chat_list_first_load.implementor.test.ts.
 */
export function chatListViewState(query: ChatListQueryState): {
  conversations: ChatListConversation[] | null;
  loaded: boolean;
  loading: boolean;
  failed: boolean;
} {
  const loaded = query.data !== undefined;
  const hasRows = (query.data?.conversations.length ?? 0) > 0;
  return {
    conversations: query.data?.conversations ?? null,
    loaded,
    loading: !loaded && (query.isPending || query.isFetching),
    failed: (query.isError && !query.isFetching && (!hasRows || !isChatListTimeout(query.error)))
      // Issue #4275: over a cached empty list a refresh retries for up to about
      // 130 s. Once an attempt has failed, that is the error row, not "no chats".
      || (loaded && !hasRows && (query.failureCount ?? 0) > 0),
  };
}

// ── Awaiting a refresh ──────────────────────────────────────────────────

const failedAttemptWaiters = new Map<string, Set<() => void>>();

/** useChatList's query function calls this when an attempt fails. */
export function noteChatListAttemptFailed(userId: string): void {
  const waiters = failedAttemptWaiters.get(userId);
  if (!waiters) return;
  failedAttemptWaiters.delete(userId);
  for (const wake of waiters) wake();
}

/**
 * Issue #4275: a refresh that the person is waiting on (pull to refresh, accepting
 * an invite) settles when it succeeds or at its first failed attempt. React Query
 * keeps retrying in the background; the list shows the error row meanwhile
 * (chatListViewState). Before, the awaiter held through every retry, about 130 s
 * over a cached empty list. Never rejects, like the refetch it wraps.
 */
export function refreshUntilFirstFailure(userId: string, refetch: () => Promise<unknown>): Promise<void> {
  let wake: () => void = () => {};
  const failedOnce = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const waiters = failedAttemptWaiters.get(userId) ?? new Set<() => void>();
  waiters.add(wake);
  failedAttemptWaiters.set(userId, waiters);
  const settled = refetch().then(() => undefined, () => undefined);
  return Promise.race([failedOnce, settled]).finally(() => {
    failedAttemptWaiters.get(userId)?.delete(wake);
  });
}
