// Issue #4114 — idempotency keys for unified chat message pushes.
//
// Direct messages: one key per (conversation, message, recipient) when the
// caller names the message, so a send retry that notifies again lands on the
// same key and notify-dispatch (which refuses a second notification with an
// existing idempotency_key) delivers exactly one push. Callers that do not send
// a message id (app builds from before #4114) keep the old per-call key.
//
// Groups: unchanged — one key per recipient per 5-minute bucket, so a burst of
// group messages collapses into one push.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnifiedMessageKeyInput {
  isGroup: boolean;
  conversationId: string;
  senderId: string;
  recipientId: string;
  messageId?: string | null;
  nowMs: number;
}

export function unifiedMessageIdempotencyKey(input: UnifiedMessageKeyInput): string {
  if (input.isGroup) {
    const fiveBucket = Math.floor(input.nowMs / (5 * 60 * 1000));
    return `group_msg:${input.conversationId}:${fiveBucket}:${input.recipientId}`;
  }
  const messageId = typeof input.messageId === "string" ? input.messageId.trim().toLowerCase() : "";
  if (UUID.test(messageId)) {
    return `dm_msg:${input.conversationId}:${messageId}:${input.recipientId}`;
  }
  return `dm:${input.senderId}:${input.conversationId}:${input.nowMs}`;
}

export interface UnifiedMessageTitleInput {
  conversationType: string;
  conversationName?: string | null;
  programKind?: "local" | "creator" | null;
  programTargetUserId?: string | null;
  senderId: string;
  senderName: string;
}

/** #4187: an Admin-authored program message is presented as the official team. */
export function unifiedMessageTitle(input: UnifiedMessageTitleInput): string {
  const officialTeam = Boolean(
    input.programKind && input.programTargetUserId && input.senderId !== input.programTargetUserId
  );
  if (officialTeam && input.conversationName) return input.conversationName;
  if (input.conversationType === "group" && input.conversationName) {
    return `${input.senderName} in ${input.conversationName}`;
  }
  return input.senderName;
}

/** #4579: looks up the name a brand chat shows for a sender (issue_4579_brand_member_name). */
export interface BrandSenderNameLookup {
  (brandId: string, senderId: string, fallback: string): Promise<{ name: string | null; error: boolean }>;
}

/**
 * #4579: the sender name for a push from a brand-linked chat. A Mingla admin
 * added to the brand automatically is named by issue_4579_admin_public_name
 * (their real first name, or "Mingla Team"), never an email or handle; anyone
 * else keeps their profile name. Other chats are unchanged. A failed lookup
 * never falls back to a name that could be a handle: it says "Someone".
 */
export async function brandChatSenderName(
  input: { linkedEntityType?: string | null; brandId?: string | null; senderId: string; fallback: string },
  lookup: BrandSenderNameLookup,
): Promise<string> {
  if (input.linkedEntityType !== "brand" || !input.brandId) return input.fallback;
  const result = await lookup(input.brandId, input.senderId, input.fallback);
  const name = result.error ? "" : (result.name ?? "").trim();
  return name.length > 0 ? name : "Someone";
}

/** #4456: a message id the push may carry, normalized, or null. */
export function pushMessageId(messageId: unknown): string | null {
  const id = typeof messageId === "string" ? messageId.trim().toLowerCase() : "";
  return UUID.test(id) ? id : null;
}

/**
 * #4456: the dispatch `data` for a chat push. It names the message, so an
 * unsend can quiet the in-app row it creates (notifications.data.messageId).
 */
export function messagePushData(deepLink: string, messageId: unknown): Record<string, string> {
  const id = pushMessageId(messageId);
  return id ? { deepLink, messageId: id } : { deepLink };
}

export interface MessageRowLookup {
  (messageId: string): Promise<{ deletedAt: string | null; found: boolean; error: boolean }>;
}

/**
 * #4456: true when the message was unsent (or removed) before its push went
 * out, so nothing is sent. A failed lookup does not block the push: an unsend
 * that lands later still quiets the in-app row.
 */
export async function unsentBeforePush(messageId: unknown, lookup: MessageRowLookup): Promise<boolean> {
  const id = pushMessageId(messageId);
  if (!id) return false;
  const row = await lookup(id);
  if (row.error) return false;
  return row.found && row.deletedAt !== null;
}

// ── #4459: the brand Guest chat (linked_entity_type 'brand_guests') ─────────
//
// One chat per brand, possibly hundreds of guests, so pushes follow Seth's rule
// (issue comment 6929280999):
//   - a post from the brand (sender_kind 'brand') pushes every guest who has
//     not muted the chat;
//   - a guest's post pushes only the people it tags or replies to, and no one
//     else (the brand team included, unless tagged or replied to).
// Muted members, blocked pairs and people no longer in the chat never get a
// push. Recipients come from the database only; a list sent by the app is
// ignored.

/** Dispatches per batch for a brand post. */
export const BRAND_GUESTS_PUSH_CHUNK = 100;
/** Mentions are capped at 10 when the message is written; never more here. */
export const BRAND_GUESTS_MAX_MENTIONS = 10;

export interface BrandGuestsMember {
  userId: string;
  muted: boolean;
  isTeam: boolean;
}

export interface BrandGuestsRecipientInput {
  senderId: string;
  senderKind: string | null | undefined;
  /** Author of the message this one replies to (from the database), if any. */
  replyToAuthorId?: string | null;
  /** User ids stored in messages.mentions (from the database). */
  mentionedUserIds: readonly string[];
  members: readonly BrandGuestsMember[];
  /** People with a block either way with the sender. */
  blockedWithSender: ReadonlySet<string>;
}

export function brandGuestsRecipients(input: BrandGuestsRecipientInput): string[] {
  const reachable = (member: BrandGuestsMember): boolean =>
    member.userId !== input.senderId && !member.muted && !input.blockedWithSender.has(member.userId);

  if (input.senderKind === "brand") {
    return input.members.filter((member) => !member.isTeam && reachable(member)).map((member) => member.userId);
  }

  const targets: string[] = [];
  if (input.replyToAuthorId) targets.push(input.replyToAuthorId);
  for (const id of input.mentionedUserIds.slice(0, BRAND_GUESTS_MAX_MENTIONS)) targets.push(id);
  const byId = new Map(input.members.map((member) => [member.userId, member]));
  const out: string[] = [];
  for (const id of targets) {
    const member = byId.get(id);
    if (!member || !reachable(member) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** The user ids stored in a messages.mentions value (entries with a userId). */
export function storedMentionUserIds(mentions: unknown): string[] {
  if (!Array.isArray(mentions)) return [];
  const ids: string[] = [];
  for (const entry of mentions) {
    const id = entry && typeof entry === "object" ? (entry as { userId?: unknown }).userId : null;
    if (typeof id === "string" && UUID.test(id) && !ids.includes(id.toLowerCase())) ids.push(id.toLowerCase());
  }
  return ids;
}

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export function brandGuestsIdempotencyKey(messageId: string, recipientId: string): string {
  return `brand_guests:${messageId}:${recipientId}`;
}

export interface BrandGuestsPushCopyInput {
  brandName: string | null | undefined;
  senderKind: string | null | undefined;
  senderDisplayName: string | null | undefined;
  preview: string;
  /** #4630 A1: the recipient is on the brand's team (keeps "<Brand> Guests"). */
  recipientIsTeam: boolean;
}

/**
 * #4630 (Q3, A1): a guest's push is titled "<Brand>" (fallback "Mingla"); a
 * brand team member keeps "<Brand> Guests", because the Host app runs two
 * chats per brand (Team and Guests) and that title tells them apart. A brand
 * post previews as the brand, a tag or reply as "<sender>: <preview>".
 */
export function brandGuestsPushCopy(input: BrandGuestsPushCopyInput): { title: string; body: string } {
  const brand = (input.brandName ?? "").trim();
  const title = input.recipientIsTeam
    ? (brand ? `${brand} Guests` : "Guests")
    : (brand || "Mingla");
  if (input.senderKind === "brand") return { title, body: input.preview };
  const sender = (input.senderDisplayName ?? "").trim() || "A guest";
  return { title, body: `${sender}: ${input.preview}` };
}

/**
 * #4459 D2: who wrote the message being replied to. A brand post stores no
 * sender (guests never learn which team member wrote it), so its author is
 * looked up in brand_guest_post_authors with the service key.
 */
export async function resolveReplyAuthor(
  repliedTo: { id?: string; sender_id?: string | null; sender_kind?: string | null } | null,
  lookupBrandPostAuthor: (messageId: string) => Promise<string | null>,
): Promise<string | null> {
  if (!repliedTo) return null;
  if (repliedTo.sender_id) return repliedTo.sender_id;
  if (repliedTo.sender_kind !== "brand" || !repliedTo.id) return null;
  return await lookupBrandPostAuthor(repliedTo.id);
}
