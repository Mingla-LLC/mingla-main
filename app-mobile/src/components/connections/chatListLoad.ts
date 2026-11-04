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
 * this loader runs the reads in three waves:
 *   wave 1 (nothing needs ids): conversations + unread, pending session
 *          invites, your brand team rows — all at once;
 *   wave 2 (needs conversation ids): sessions, session phone invites, event
 *          meta and ONE profiles read (participants ∪ last-message senders ∪
 *          inviters) — all at once;
 *   wave 3 (rare): profiles only for session people the first read missed.
 *
 * Pure and dependency-free (every read is injected) so it runs under Deno.
 */

/** How long a loaded list is fresh: revisits inside this window do not refetch. */
export const CHAT_LIST_STALE_TIME_MS = 30_000;
/** The conversations read gives up after this long (background-suspended sockets can hang). */
export const CHAT_LIST_TIMEOUT_MS = 10_000;

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

export type ChatListLinkedEntity = "direct" | "session" | "trip" | "event";

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

export type ChatSessionRow = {
  id: string;
  name: string | null;
  created_by: string | null;
  status?: string | null;
  session_participants?: ReadonlyArray<{ user_id: string; has_accepted: boolean | null }> | null;
  collaboration_invites?: ReadonlyArray<{
    id: string;
    invited_user_id: string;
    status: string | null;
    created_at: string | null;
  }> | null;
};

export type ChatSessionPhoneInvite = {
  id: string;
  session_id: string;
  phone_e164: string | null;
  status?: string | null;
  created_at?: string | null;
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

export type ChatListPendingInvite = {
  sessionId: string;
  inviteId: string;
  inviterDisplayName: string;
  inviterAvatarUrl: string | null;
  createdAt: string;
};

export type ChatListPendingPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: "creator" | "pending" | "accepted";
  inviteKind: "warm" | "cold" | null;
  inviteId: string | null;
  phoneE164?: string | null;
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
  fetchSessionPhoneInvites(sessionIds: string[]): Promise<ChatSessionPhoneInvite[]>;
  fetchEventMeta(eventIds: string[]): Promise<Map<string, ChatEventMeta<TCard>>>;
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

function sessionRowsOf(row: ChatSessionRow | undefined) {
  return {
    participants: [...(row?.session_participants ?? [])],
    invites: [...(row?.collaboration_invites ?? [])],
  };
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
  }

  // Inviter profiles ride on the same profiles read. The invites read started
  // with the conversations read, so it is normally done already.
  const rawInvites = await invitesPromise;
  for (const invite of rawInvites) {
    if (invite.inviter_id) firstProfileIds.add(invite.inviter_id);
  }

  // ── Wave 2: everything that needs conversation ids, at once ──
  const sessionIdList = Array.from(groupSessionIds);
  const [sessions, phoneInvites, eventMetaMap, firstProfiles, teamRows] = await Promise.all([
    sessionIdList.length > 0 ? deps.fetchSessions(sessionIdList) : Promise.resolve([] as ChatSessionRow[]),
    sessionIdList.length > 0
      ? deps.fetchSessionPhoneInvites(sessionIdList)
      : Promise.resolve([] as ChatSessionPhoneInvite[]),
    deps.fetchEventMeta(Array.from(groupEventIds)).catch((error: unknown) => {
      deps.warn("[ConnectionsPage] Failed to batch-resolve group chat event metadata:", error);
      return new Map<string, ChatEventMeta<TCard>>();
    }),
    firstProfileIds.size > 0 ? deps.fetchProfiles(Array.from(firstProfileIds)) : Promise.resolve([] as ChatListProfile[]),
    // With no event chats there is nothing to fold or hide: the team set is empty.
    groupEventIds.size > 0 ? teamsPromise : teamsPromise.then(() => [] as string[]),
  ]);

  // ── Wave 3 (rare): session people the first profiles read did not cover ──
  const profilesMap = new Map<string, ChatListProfile>(firstProfiles.map((profile) => [profile.id, profile]));
  const missingIds = new Set<string>();
  for (const session of sessions) {
    for (const participant of session.session_participants ?? []) {
      if (participant.user_id && !firstProfileIds.has(participant.user_id)) missingIds.add(participant.user_id);
    }
    for (const invite of session.collaboration_invites ?? []) {
      if (invite.invited_user_id && !firstProfileIds.has(invite.invited_user_id)) missingIds.add(invite.invited_user_id);
    }
  }
  if (missingIds.size > 0) {
    for (const profile of await deps.fetchProfiles(Array.from(missingIds))) profilesMap.set(profile.id, profile);
  }

  const senderProfiles = Array.from(senderIds)
    .map((id) => profilesMap.get(id))
    .filter((profile): profile is ChatListProfile => Boolean(profile));
  if (senderProfiles.length > 0) deps.rememberSenderProfiles?.(senderProfiles);

  let teamBrandIds: string[] | null = null;
  if (teamRows !== null) {
    // The brand's owner is on its team too (owner trigger); account_id is a belt and braces.
    const owned = Array.from(eventMetaMap.values())
      .filter((meta) => meta.brandId && meta.brandAccountId === userId)
      .map((meta) => meta.brandId as string);
    teamBrandIds = Array.from(new Set([...teamRows, ...owned])).sort();
  }

  const phoneInvitesBySession = new Map<string, ChatSessionPhoneInvite[]>();
  for (const invite of phoneInvites) {
    const rows = phoneInvitesBySession.get(invite.session_id) ?? [];
    rows.push(invite);
    phoneInvitesBySession.set(invite.session_id, rows);
  }
  const sessionMetaMap = new Map(
    sessions.map((session) => [
      session.id,
      {
        name: session.name,
        created_by: session.created_by,
        status: session.status ?? null,
        ...sessionRowsOf(session),
        phoneInvites: phoneInvitesBySession.get(session.id) ?? [],
      },
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
    const eventPublicUrl = deps.eventPublicUrl(eventMeta, linkedEntityType);
    const eventPublicCard = eventMeta?.publicCard
      ? {
          ...eventMeta.publicCard,
          publicBuyerUrl: eventPublicUrl ?? eventMeta.publicCard.publicBuyerUrl,
        }
      : null;
    const conversationName = eventMeta?.title?.trim()
      || conv.name?.trim()
      || sessionMeta?.name?.trim()
      || null;
    const sessionParticipants = sessionMeta?.participants ?? [];
    const acceptedParticipantIds = new Set(
      sessionParticipants
        .filter((participant) => participant.has_accepted === true)
        .map((participant) => participant.user_id),
    );
    const hasAcceptedCollaborator = sessionParticipants.some(
      (participant) => participant.user_id !== userId && participant.has_accepted === true,
    );
    const pendingInvitedIds = new Set(
      (sessionMeta?.invites ?? [])
        .filter((invite) => invite.status === "pending")
        .map((invite) => invite.invited_user_id),
    );
    const pendingInviteByUserId = new Map(
      (sessionMeta?.invites ?? [])
        .filter((invite) => invite.status === "pending")
        .map((invite) => [invite.invited_user_id, invite]),
    );
    const isPendingCreatorCollab =
      conv.type === "group" &&
      linkedEntityType === "session" &&
      !!sessionId &&
      sessionMeta?.created_by === userId &&
      !hasAcceptedCollaborator;
    const pendingPeople: ChatListPendingPerson[] = sessionParticipants
      .filter((participant) => participant.user_id)
      .map((participant) => {
        const profile = profilesMap.get(participant.user_id);
        const isCreator = participant.user_id === sessionMeta?.created_by;
        return {
          id: participant.user_id,
          name: isCreator && participant.user_id === userId
            ? "You"
            : deps.displayName(profile, "Mingla friend"),
          avatarUrl: profile?.avatar_url ?? null,
          status: isCreator
            ? "creator"
            : participant.has_accepted === true
              ? "accepted"
              : "pending",
          inviteKind:
            !isCreator && participant.has_accepted !== true ? "warm" : null,
          inviteId: pendingInviteByUserId.get(participant.user_id)?.id ?? null,
        };
      });
    for (const inviteeId of pendingInvitedIds) {
      if (pendingPeople.some((person) => person.id === inviteeId)) continue;
      const profile = profilesMap.get(inviteeId);
      pendingPeople.push({
        id: inviteeId,
        name: deps.displayName(profile, "Mingla friend"),
        avatarUrl: profile?.avatar_url ?? null,
        status: acceptedParticipantIds.has(inviteeId) ? "accepted" : "pending",
        inviteKind: acceptedParticipantIds.has(inviteeId) ? null : "warm",
        inviteId: pendingInviteByUserId.get(inviteeId)?.id ?? null,
      });
    }
    for (const invite of sessionMeta?.phoneInvites ?? []) {
      pendingPeople.push({
        id: `phone:${invite.id}`,
        name: invite.phone_e164 || "Phone invite",
        avatarUrl: null,
        status: "pending",
        inviteKind: "cold",
        inviteId: invite.id,
        phoneE164: invite.phone_e164 ?? null,
      });
    }

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
      program_kind: programKind,
      sessionCreatorId: sessionMeta?.created_by ?? null,
      sessionStatus: sessionMeta?.status ?? null,
      isPendingCreatorCollab,
      __pendingCollabChat: isPendingCreatorCollab && sessionId
        ? {
            conversationId: conv.id,
            sessionId,
            sessionName: conversationName || "Collaboration chat",
            people: pendingPeople,
            existingUserIds: Array.from(
              new Set([
                ...pendingPeople.map((person) => person.id),
                userId,
              ]),
            ),
          }
        : undefined,
      is_broadcast_only: Boolean(conv.is_broadcast_only),
      eventBrandName: eventMeta?.brandName ?? null,
      eventBrandAccountId: eventMeta?.brandAccountId ?? null,
      // Issue #4114 Wave 6: what the brand channel fold reads.
      eventBrandId: eventMeta?.brandId ?? null,
      eventBrandSlug: eventMeta?.brandSlug ?? null,
      eventBrandLogoUrl: eventMeta?.brandLogoUrl ?? null,
      // Channel fold orders by next occurrence; publicCard keeps true master*.
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

  return { conversations: [...pendingInviteRows, ...transformed], teamBrandIds };
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
};

/**
 * Cached rows render at once, also while a background refresh runs; the
 * skeleton shows only when there is no list yet (the first-ever visit). A
 * failed refresh shows the error row only once it has settled, and never for
 * a timeout (expected after the app was in the background).
 */
export function chatListViewState(query: ChatListQueryState): {
  conversations: ChatListConversation[] | null;
  loading: boolean;
  failed: boolean;
} {
  return {
    conversations: query.data?.conversations ?? null,
    loading: !query.data && (query.isPending || query.isFetching),
    failed: query.isError && !query.isFetching && !isChatListTimeout(query.error),
  };
}
