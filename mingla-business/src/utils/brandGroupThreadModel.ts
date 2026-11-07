/**
 * #4304 part 2 — the Brand-group chat model, ported from the Explorer chats
 * (app-mobile utils/messageGrouping.ts + the #4114 thread model). Pure: no
 * React, no services, so every rule here is unit-tested.
 */

export const BRAND_GROUP_CLUSTER_MS = 2 * 60 * 1000;

/** The six reactions the app offers (the database refuses any other). */
export const BRAND_GROUP_REACTION_EMOJI = ["❤️", "👍", "😂", "😮", "😢", "🔥"] as const;
export type BrandGroupReactionEmoji = (typeof BRAND_GROUP_REACTION_EMOJI)[number];
export const BRAND_GROUP_HEART: BrandGroupReactionEmoji = "❤️";

export interface BrandGroupClusterInput {
  id: string;
  sender_id: string | null;
  sender_role: string | null;
  created_at: string;
  message_type?: string | null;
}

export type BrandGroupClusterPosition = "solo" | "first" | "middle" | "last";

export type BrandGroupThreadItem<T extends BrandGroupClusterInput> =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      message: T;
      position: BrandGroupClusterPosition;
      /** First bubble of a cluster from someone else: name + role above it. */
      showSender: boolean;
      /** Last bubble of a cluster from someone else: their avatar beside it. */
      showAvatar: boolean;
      /** Last bubble of a cluster: the time under it. */
      showTime: boolean;
    };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function wholeDaysBetween(earlier: Date, later: Date): number {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / 86_400_000);
}

/** "Today", "Yesterday", "Tue 4 Nov", or "Tue 4 Nov 2025" in another year. */
export function brandGroupDayLabel(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : parse(value);
  if (!date) return "";
  const days = wholeDaysBetween(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const base = `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** The clock time in the person's own locale ("14:05" / "2:05 PM"). */
export function brandGroupClockTime(value: string | Date): string {
  const date = value instanceof Date ? value : parse(value);
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Inbox time: today the clock time, this week the weekday, else the date. */
export function brandGroupInboxTime(value: string | null, now: Date = new Date()): string {
  const date = parse(value);
  if (!date) return "";
  const days = wholeDaysBetween(date, now);
  if (days <= 0) return brandGroupClockTime(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return WEEKDAYS[date.getDay()];
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** Quiet, non-bubble rows (system lines, enquiry cards) break a cluster. */
function clusterable(message: BrandGroupClusterInput): boolean {
  return message.message_type !== "system" && message.message_type !== "brand_enquiry_card";
}

function sameCluster(previous: BrandGroupClusterInput, current: BrandGroupClusterInput): boolean {
  if (!clusterable(previous) || !clusterable(current)) return false;
  if (!previous.sender_id || previous.sender_id !== current.sender_id) return false;
  if ((previous.sender_role ?? null) !== (current.sender_role ?? null)) return false;
  const before = parse(previous.created_at);
  const after = parse(current.created_at);
  if (!before || !after) return false;
  if (dayKey(before) !== dayKey(after)) return false;
  return after.getTime() - before.getTime() < BRAND_GROUP_CLUSTER_MS;
}

/**
 * Oldest-first messages → day separators + clustered bubbles. Same sender,
 * same role and under two minutes apart on the same day share a cluster.
 */
export function buildBrandGroupThreadItems<T extends BrandGroupClusterInput>(
  messages: readonly T[],
  viewerId: string | null,
  now: Date = new Date(),
): BrandGroupThreadItem<T>[] {
  const items: BrandGroupThreadItem<T>[] = [];
  let currentDay: string | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const date = parse(message.created_at);
    const key = date ? dayKey(date) : "unknown";
    if (key !== currentDay) {
      currentDay = key;
      items.push({ kind: "day", key: `day:${key}`, label: date ? brandGroupDayLabel(date, now) : "" });
    }
    const previous = index > 0 ? messages[index - 1] : null;
    const next = index + 1 < messages.length ? messages[index + 1] : null;
    const joinsPrevious = previous ? sameCluster(previous, message) : false;
    const joinsNext = next ? sameCluster(message, next) : false;
    const position: BrandGroupClusterPosition = joinsPrevious
      ? (joinsNext ? "middle" : "last")
      : (joinsNext ? "first" : "solo");
    const mine = viewerId !== null && message.sender_id === viewerId;
    const startsCluster = position === "solo" || position === "first";
    const endsCluster = position === "solo" || position === "last";
    items.push({
      kind: "message",
      key: message.id,
      message,
      position,
      showSender: !mine && startsCluster,
      showAvatar: !mine && endsCluster,
      showTime: endsCluster,
    });
  }
  return items;
}

/** First name for compact lists: "Ada Lovelace" → "Ada". */
export function brandGroupFirstName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

/** "Ada, Kim, Seth +4" — never the viewer, never fabricated. */
export function brandGroupNamesSummary(
  names: readonly string[],
  max = 3,
): string {
  const clean = names.map(brandGroupFirstName).filter((name) => name.length > 0);
  if (clean.length === 0) return "";
  const shown = clean.slice(0, max).join(", ");
  const rest = clean.length - max;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

export function brandGroupHeaderSubtitle(
  members: readonly { user_id: string; display_name: string }[],
  viewerId: string | null,
): string {
  const others = members.filter((member) => member.user_id !== viewerId);
  if (others.length === 0) return members.length > 0 ? "Just you so far" : "";
  return brandGroupNamesSummary(others.map((member) => member.display_name));
}

export function brandGroupTypingText(names: readonly string[]): string | null {
  const clean = names.map(brandGroupFirstName).filter((name) => name.length > 0);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `${clean[0]} is typing…`;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]} are typing…`;
  return `${clean.length} people are typing…`;
}

export interface BrandGroupReadState {
  user_id: string;
  display_name: string;
  last_read_at: string;
}

/**
 * "Seen by Ada, Kim +1" under the viewer's latest message, only when it is the
 * newest message in the thread. Readers come from the real read pointers.
 */
export function brandGroupSeenBy(
  messages: readonly BrandGroupClusterInput[],
  reads: readonly BrandGroupReadState[],
  viewerId: string | null,
): { messageId: string; text: string } | null {
  if (!viewerId || messages.length === 0) return null;
  const latest = messages[messages.length - 1];
  if (latest.sender_id !== viewerId) return null;
  const sentAt = parse(latest.created_at);
  if (!sentAt) return null;
  const readers = reads
    .filter((read) => read.user_id !== viewerId)
    .filter((read) => {
      const readAt = parse(read.last_read_at);
      return readAt !== null && readAt.getTime() >= sentAt.getTime();
    })
    .map((read) => read.display_name);
  const summary = brandGroupNamesSummary(readers, 2);
  return summary ? { messageId: latest.id, text: `Seen by ${summary}` } : null;
}

// ── Reactions ───────────────────────────────────────────────────────────────

export interface BrandGroupReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface BrandGroupReactionPill {
  emoji: string;
  count: number;
  mine: boolean;
}

export function summariseBrandGroupReactions(
  rows: readonly BrandGroupReactionRow[],
  viewerId: string | null,
): Map<string, BrandGroupReactionPill[]> {
  const byMessage = new Map<string, Map<string, BrandGroupReactionPill>>();
  for (const row of rows) {
    const pills = byMessage.get(row.message_id) ?? new Map<string, BrandGroupReactionPill>();
    const pill = pills.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    pill.count += 1;
    if (viewerId !== null && row.user_id === viewerId) pill.mine = true;
    pills.set(row.emoji, pill);
    byMessage.set(row.message_id, pills);
  }
  const result = new Map<string, BrandGroupReactionPill[]>();
  for (const [messageId, pills] of byMessage) {
    const order = (emoji: string): number => {
      const offered = (BRAND_GROUP_REACTION_EMOJI as readonly string[]).indexOf(emoji);
      return offered === -1 ? BRAND_GROUP_REACTION_EMOJI.length : offered;
    };
    result.set(messageId, [...pills.values()].sort((a, b) => order(a.emoji) - order(b.emoji)));
  }
  return result;
}

/** Tapping an emoji removes the viewer's own row, or adds one. */
export function brandGroupReactionToggle(
  rows: readonly BrandGroupReactionRow[],
  messageId: string,
  emoji: string,
  viewerId: string,
): { action: "add" } | { action: "remove"; rowId: string } {
  const existing = rows.find((row) =>
    row.message_id === messageId && row.user_id === viewerId && row.emoji === emoji
  );
  return existing ? { action: "remove", rowId: existing.id } : { action: "add" };
}

// ── Context menu ────────────────────────────────────────────────────────────

export type BrandGroupMenuActionKey = "reply" | "copy" | "signal" | "select";

export interface BrandGroupMenuAction {
  key: BrandGroupMenuActionKey;
  label: string;
  accessibilityLabel: string;
}

/**
 * The actions a message offers (long-press on phones, right-click or the "⋯"
 * on web). Every action listed here is wired: Copy only when there is text,
 * Create product signal only for Support staff.
 */
export function buildBrandGroupMessageMenu(input: {
  senderName: string;
  hasText: boolean;
  canSupport: boolean;
  selected: boolean;
}): BrandGroupMenuAction[] {
  const actions: BrandGroupMenuAction[] = [
    { key: "reply", label: "Reply", accessibilityLabel: `Reply to ${input.senderName}` },
  ];
  if (input.hasText) {
    actions.push({ key: "copy", label: "Copy", accessibilityLabel: "Copy message text" });
  }
  if (input.canSupport) {
    actions.push({
      key: "signal",
      label: "Create product signal",
      accessibilityLabel: "Create product signal from this message",
    });
  }
  actions.push({
    key: "select",
    label: input.selected ? "Unselect" : "Select",
    accessibilityLabel: input.selected
      ? "Remove message from related context"
      : "Add message to related context",
  });
  return actions;
}

// ── Inbox ───────────────────────────────────────────────────────────────────

export interface BrandGroupInboxInput {
  conversation_id: string;
  brand_name: string;
  last_message_preview: string;
  member_count: number;
  unread_count: number;
  access_kind: "brand" | "support";
  last_message_sender_id?: string | null;
  last_message_sender_name?: string | null;
  last_message_type?: string | null;
}

export type BrandGroupInboxFilter = "all" | "unread" | "mine" | "supporting";

/** "Ada: Doors at 7?", "You: On it", "Photo", or a calm empty line. */
export function brandGroupInboxPreview(group: BrandGroupInboxInput, viewerId: string | null): string {
  const type = group.last_message_type ?? "text";
  const body = type === "image"
    ? "Photo"
    : type === "video"
      ? "Video"
      : (group.last_message_preview ?? "").replace(/\s+/g, " ").trim();
  if (!body) return `${group.member_count} people · Brand group`;
  if (type === "system" || type === "brand_enquiry_card") return body;
  if (viewerId && group.last_message_sender_id === viewerId) return `You: ${body}`;
  const speaker = brandGroupFirstName(group.last_message_sender_name);
  return speaker ? `${speaker}: ${body}` : body;
}

export function filterBrandGroups<T extends BrandGroupInboxInput>(
  groups: readonly T[],
  filter: BrandGroupInboxFilter,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return groups.filter((group) => {
    if (filter === "unread" && group.unread_count <= 0) return false;
    if (filter === "mine" && group.access_kind !== "brand") return false;
    if (filter === "supporting" && group.access_kind !== "support") return false;
    if (!needle) return true;
    return group.brand_name.toLowerCase().includes(needle)
      || (group.last_message_preview ?? "").toLowerCase().includes(needle);
  });
}

/** A stable warm hue per brand for the initial tile when there is no logo. */
export function brandGroupTileColours(seed: string): [string, string] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return [`hsl(${hue}, 62%, 52%)`, `hsl(${(hue + 28) % 360}, 58%, 34%)`];
}

/** Where a Brand group opens: Support access replies as Mingla Support. */
export function brandGroupThreadHref(group: { conversation_id: string; access_kind: "brand" | "support" }): string {
  const mode = group.access_kind === "support" ? "support" : "brand";
  return `/messages/${group.conversation_id}?mode=${mode}`;
}

export interface BrandGroupTextSegment {
  text: string;
  mention: boolean;
}

/**
 * Splits a message into plain text and "@Name" mentions of known teammates
 * (the composer inserts mentions as "@Display Name"). Longest names match
 * first so "@Ada Lovelace" wins over "@Ada".
 */
export function splitBrandGroupMentions(
  content: string,
  names: readonly string[],
): BrandGroupTextSegment[] {
  const candidates = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const segments: BrandGroupTextSegment[] = [];
  let buffer = "";
  let index = 0;
  while (index < content.length) {
    if (content[index] === "@") {
      const previous = index > 0 ? content[index - 1] : " ";
      const rest = content.slice(index + 1);
      const match = /\s/.test(previous) || index === 0
        ? candidates.find((name) => {
          if (!rest.toLowerCase().startsWith(name.toLowerCase())) return false;
          const after = rest.charAt(name.length);
          return after === "" || !/[\p{L}\p{N}_]/u.test(after);
        })
        : undefined;
      if (match) {
        if (buffer) segments.push({ text: buffer, mention: false });
        buffer = "";
        segments.push({ text: content.slice(index, index + 1 + match.length), mention: true });
        index += 1 + match.length;
        continue;
      }
    }
    buffer += content[index];
    index += 1;
  }
  if (buffer) segments.push({ text: buffer, mention: false });
  return segments;
}
