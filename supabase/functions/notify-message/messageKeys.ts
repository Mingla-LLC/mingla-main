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
