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
