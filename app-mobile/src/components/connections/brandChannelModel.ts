/**
 * Issue #4114 Wave 6 — the brand channel (design D10 / D11).
 *
 * Hosts keep one chat per event or trip. A guest sees ONE row and ONE thread
 * per brand that merges every event and trip chat of that brand they are in.
 * Nothing new exists on the server: each event still has its own `group`
 * conversation (linked_entity_type 'event' | 'trip'), and this file only
 * decides, on the phone, how those chats fold together.
 *
 * Not the same as `linked_entity_type = 'brand'`, the internal #3720 brand team
 * group that explorers never see. That is why this is called the "brand
 * channel" everywhere in code.
 *
 * Rules:
 *  - Event and trip chats with the same brand fold into one row, unless you
 *    are on that brand's team: team members keep the per-event chats.
 *  - The row's unread count is the sum of the folded chats' counts.
 *  - Where a message goes (D10): with one upcoming event (almost everyone)
 *    there is no choice. Only with two or more UPCOMING events does the
 *    "Sending to" chip appear, defaulting to the soonest. Past events never
 *    trigger it. A reply always goes to the quoted message's event, even an
 *    ended one. Each event's guests only ever see their own event's chat.
 *  - Enquiries (#4111, D11) are never folded in: they are private rows of
 *    their own (chatListModel kind "enquiry").
 *
 * Pure and dependency-free (no React Native imports) so it runs under Deno
 * (see __tests__/issue_4114_brand_channel_model.implementor.happy.test.ts).
 * MINGLA-INVARIANT: I-4114-BRAND-CHANNEL-SEND-TARGET | issue #4114 | A brand channel message is written to exactly one event's conversation: the quoted message's when replying, otherwise the chosen upcoming event when two or more are upcoming, otherwise the soonest upcoming (or latest) event.
 */

export const BRAND_CHANNEL_ID_PREFIX = "brand-channel:";

export function brandChannelId(brandId: string): string {
  return `${BRAND_CHANNEL_ID_PREFIX}${brandId}`;
}

export function isBrandChannelId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(BRAND_CHANNEL_ID_PREFIX);
}

/** The fields of a list conversation the fold reads (ConnectionsPage's Conversation satisfies it). */
export interface BrandChannelSourceConversation {
  id: string;
  created_at: string;
  type?: "direct" | "group";
  linked_entity_type?: string;
  name?: string | null;
  event_id?: string | null;
  participants: ReadonlyArray<BrandChannelPerson>;
  unread_count?: number;
  marked_unread_at?: string | null;
  pinned_at?: string | null;
  last_message?: {
    content?: string | null;
    created_at?: string | null;
    message_type?: string | null;
    sender_id?: string | null;
  } | null;
  eventBrandId?: string | null;
  eventBrandName?: string | null;
  eventBrandSlug?: string | null;
  eventBrandLogoUrl?: string | null;
  eventBrandAccountId?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  /** The event page seed (BusinessEventCard); opaque here. */
  eventPublicCard?: unknown;
}

/** A person in one event chat (the per-event guest list). */
export interface BrandChannelPerson {
  id: string;
  username?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

export interface BrandChannelEvent {
  conversationId: string;
  eventId: string | null;
  title: string;
  linkedEntityType: "event" | "trip";
  startAt: string | null;
  endAt: string | null;
  participantCount: number;
  unreadCount: number;
  /** This event's own guests (never merged across events). */
  people: readonly BrandChannelPerson[];
  /** The event page seed for the existing event / trip overlay. */
  publicCard: unknown;
}

export interface BrandChannel {
  id: string;
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  logoUrl: string | null;
  brandAccountId: string | null;
  /** Soonest first; events with no date last. */
  events: BrandChannelEvent[];
}

/** One folded row in the Chats list. */
export type BrandChannelRow<C extends BrandChannelSourceConversation> = C & {
  __brandChannel: BrandChannel;
  /** The event the newest message came from (the row preview leads with it). */
  brandChannelLastEventTitle: string | null;
};

function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

function isOfferingChat(conversation: BrandChannelSourceConversation): boolean {
  return conversation.type === "group" &&
    (conversation.linked_entity_type === "event" || conversation.linked_entity_type === "trip");
}

/** True when this chat folds into a brand channel for this user. */
export function foldsIntoBrandChannel(
  conversation: BrandChannelSourceConversation,
  teamBrandIds: ReadonlySet<string>,
): boolean {
  if (!isOfferingChat(conversation)) return false;
  const brandId = conversation.eventBrandId;
  if (!brandId) return false;
  return !teamBrandIds.has(brandId);
}

function activityTime(conversation: BrandChannelSourceConversation): number {
  const time = timeOf(conversation.last_message?.created_at || conversation.created_at);
  return Number.isNaN(time) ? 0 : time;
}

function compareEvents(left: BrandChannelEvent, right: BrandChannelEvent): number {
  const a = timeOf(left.startAt);
  const b = timeOf(right.startAt);
  const aValid = !Number.isNaN(a);
  const bValid = !Number.isNaN(b);
  if (aValid && bValid && a !== b) return a - b;
  if (aValid !== bValid) return aValid ? -1 : 1;
  return left.conversationId.localeCompare(right.conversationId);
}

function toEvent(conversation: BrandChannelSourceConversation): BrandChannelEvent {
  return {
    conversationId: conversation.id,
    eventId: conversation.event_id ?? null,
    title: conversation.name?.trim() || "",
    linkedEntityType: conversation.linked_entity_type === "trip" ? "trip" : "event",
    startAt: conversation.eventStartAt ?? null,
    endAt: conversation.eventEndAt ?? null,
    participantCount: conversation.participants.length,
    unreadCount: conversation.unread_count ?? 0,
    people: conversation.participants,
    publicCard: conversation.eventPublicCard ?? null,
  };
}

/** The sum of the folded chats' unread counts. */
export function brandChannelUnread(members: readonly BrandChannelSourceConversation[]): number {
  return members.reduce((sum, member) => sum + Math.max(0, member.unread_count ?? 0), 0);
}

/**
 * Folds a guest's event and trip chats into one row per brand. Every other
 * chat (and every chat of a brand you are on the team of) passes through
 * unchanged, in its original position; a brand row takes the position of the
 * brand's first chat in the input. Returns the channels by id as well.
 */
export function foldBrandChannels<C extends BrandChannelSourceConversation>(
  conversations: readonly C[],
  teamBrandIds: ReadonlySet<string>,
): { rows: Array<C | BrandChannelRow<C>>; channels: Map<string, BrandChannel> } {
  const membersByBrand = new Map<string, C[]>();
  for (const conversation of conversations) {
    if (!foldsIntoBrandChannel(conversation, teamBrandIds)) continue;
    const brandId = conversation.eventBrandId as string;
    const list = membersByBrand.get(brandId) ?? [];
    list.push(conversation);
    membersByBrand.set(brandId, list);
  }

  const channels = new Map<string, BrandChannel>();
  const rowsByBrand = new Map<string, BrandChannelRow<C>>();
  for (const [brandId, members] of membersByBrand) {
    const newest = [...members].sort((a, b) => activityTime(b) - activityTime(a))[0];
    const withBrand = members.find((member) => member.eventBrandName?.trim()) ?? newest;
    const channel: BrandChannel = {
      id: brandChannelId(brandId),
      brandId,
      brandName: withBrand.eventBrandName?.trim() || newest.name?.trim() || "",
      brandSlug: members.find((member) => member.eventBrandSlug)?.eventBrandSlug ?? null,
      logoUrl: members.find((member) => member.eventBrandLogoUrl)?.eventBrandLogoUrl ?? null,
      brandAccountId: members.find((member) => member.eventBrandAccountId)?.eventBrandAccountId ?? null,
      events: members.map(toEvent).sort(compareEvents),
    };
    channels.set(channel.id, channel);
    const unread = brandChannelUnread(members);
    const markedUnreadAt = unread === 0
      ? members.map((member) => member.marked_unread_at).find((value) => Boolean(value)) ?? null
      : null;
    const pinnedAt = members
      .map((member) => member.pinned_at)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
    rowsByBrand.set(brandId, {
      ...newest,
      id: channel.id,
      name: channel.brandName,
      unread_count: unread,
      marked_unread_at: markedUnreadAt,
      pinned_at: pinnedAt,
      last_message: newest.last_message ?? null,
      created_at: newest.created_at,
      participants: [],
      __brandChannel: channel,
      brandChannelLastEventTitle: newest.last_message ? newest.name?.trim() || null : null,
    } as BrandChannelRow<C>);
  }

  const rows: Array<C | BrandChannelRow<C>> = [];
  const placed = new Set<string>();
  for (const conversation of conversations) {
    if (!foldsIntoBrandChannel(conversation, teamBrandIds)) {
      rows.push(conversation);
      continue;
    }
    const brandId = conversation.eventBrandId as string;
    if (placed.has(brandId)) continue;
    placed.add(brandId);
    const row = rowsByBrand.get(brandId);
    if (row) rows.push(row);
  }
  return { rows, channels };
}

export function isBrandChannelRow(value: unknown): value is { __brandChannel: BrandChannel } {
  return Boolean(value && typeof value === "object" && (value as { __brandChannel?: unknown }).__brandChannel);
}

// ── Event state ─────────────────────────────────────────────────────────────

/** Ended once its end (or, with no end, its start) is in the past. Unknown dates never count as ended. */
export function isEventEnded(event: Pick<BrandChannelEvent, "startAt" | "endAt">, now: number): boolean {
  const end = timeOf(event.endAt ?? event.startAt);
  return !Number.isNaN(end) && end < now;
}

/** Upcoming events (dated, not ended), soonest first. */
export function upcomingEvents(events: readonly BrandChannelEvent[], now: number): BrandChannelEvent[] {
  return events
    .filter((event) => !Number.isNaN(timeOf(event.startAt)) && !isEventEnded(event, now))
    .sort(compareEvents);
}

/** The "Next up" card's event: the soonest upcoming one, or null when none is upcoming. */
export function nextUpEvent(events: readonly BrandChannelEvent[], now: number): BrandChannelEvent | null {
  return upcomingEvents(events, now)[0] ?? null;
}

/** D10: the "Sending to" chip shows only with two or more upcoming events. */
export function showSendTargetChip(events: readonly BrandChannelEvent[], now: number): boolean {
  return upcomingEvents(events, now).length >= 2;
}

/** Where a new (non-reply) message goes by default: the soonest upcoming event, else the latest one. */
export function defaultSendTarget(events: readonly BrandChannelEvent[], now: number): string | null {
  const next = nextUpEvent(events, now);
  if (next) return next.conversationId;
  if (events.length === 0) return null;
  const latest = [...events].sort((a, b) => compareEvents(b, a))[0];
  return latest.conversationId;
}

/**
 * D10: the one conversation a message is written to.
 *  1. a reply goes to the quoted message's event (even an ended one);
 *  2. with the chip showing, the event you picked, if it is still upcoming;
 *  3. otherwise the default (soonest upcoming, else latest).
 */
export function resolveSendTarget(args: {
  events: readonly BrandChannelEvent[];
  chosenConversationId: string | null;
  replyToConversationId: string | null;
  now: number;
}): string | null {
  const { events, chosenConversationId, replyToConversationId, now } = args;
  if (replyToConversationId && events.some((event) => event.conversationId === replyToConversationId)) {
    return replyToConversationId;
  }
  if (chosenConversationId && showSendTargetChip(events, now)) {
    const upcoming = upcomingEvents(events, now);
    if (upcoming.some((event) => event.conversationId === chosenConversationId)) return chosenConversationId;
  }
  return defaultSendTarget(events, now);
}

export function findBrandChannelEvent(
  channel: Pick<BrandChannel, "events"> | null | undefined,
  conversationId: string | null | undefined,
): BrandChannelEvent | null {
  if (!channel || !conversationId) return null;
  return channel.events.find((event) => event.conversationId === conversationId) ?? null;
}

// ── The merged thread ───────────────────────────────────────────────────────

export interface BrandChannelThreadMessage {
  id: string;
  timestamp: string;
  conversationId?: string;
}

/**
 * Every member chat's loaded messages as one time-sorted list, each tagged
 * with the conversation it belongs to. `merge` is Wave 1's `mergeMessages`
 * (passed in so this file stays dependency-free).
 */
export function brandChannelMessages<T extends BrandChannelThreadMessage>(
  lists: ReadonlyArray<{ conversationId: string; messages: readonly T[] }>,
  merge: (prev: readonly T[], incoming: readonly T[]) => T[],
): T[] {
  const tagged: T[] = [];
  for (const list of lists) {
    for (const message of list.messages) {
      tagged.push(message.conversationId === list.conversationId ? message : { ...message, conversationId: list.conversationId });
    }
  }
  return merge([], tagged);
}

/**
 * Ids of the messages that start a run from a new event (oldest first): the
 * thread draws an event marker above each of them. Messages with no
 * conversation id (ordinary chats) never start a run.
 */
export function eventMarkerMessageIds(messagesOldestFirst: readonly BrandChannelThreadMessage[]): Set<string> {
  const ids = new Set<string>();
  let previous: string | undefined;
  for (const message of messagesOldestFirst) {
    if (!message.conversationId) continue;
    if (message.conversationId !== previous) ids.add(message.id);
    previous = message.conversationId;
  }
  return ids;
}

/** Chats-list search: the brand name or any of its event titles. */
export function brandChannelMatchesSearch(channel: BrandChannel, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const candidates = [channel.brandName, ...channel.events.map((event) => event.title)];
  return candidates.some((candidate) => candidate.toLowerCase().replace(/\s+/g, " ").includes(normalizedQuery));
}
