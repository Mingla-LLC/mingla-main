/**
 * #4459 (QA retest P3): chats this user has just left. Presence writes for
 * them are refused by RLS (42501: you are no longer a participant), so the
 * presence service skips them instead of sending a write that must fail.
 * A rejoin clears the mark.
 */
const leftConversations = new Set<string>();

export function markConversationLeft(conversationId: string): void {
  leftConversations.add(conversationId);
}

export function markConversationRejoined(conversationId: string): void {
  leftConversations.delete(conversationId);
}

export function hasLeftConversation(conversationId: string): boolean {
  return leftConversations.has(conversationId);
}
