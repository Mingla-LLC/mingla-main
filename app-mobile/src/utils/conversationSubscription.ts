/**
 * Issue #4114 Wave 1 — which conversation's live channel is open.
 *
 * Opening chat B used to "clean up" by unsubscribing B (the id being opened)
 * instead of A, so chat A's live channel kept running and its messages could
 * land in B's list. The subscribed id now lives in one ref, and switching always
 * releases the id that was actually subscribed.
 *
 * Pure (no React Native imports) so it runs under Deno.
 */

export interface ConversationUnsubscriber {
  unsubscribeFromConversation(conversationId: string): void;
}

export interface SubscribedConversationRef {
  current: string | null;
}

/** Closes the channel that is open now, if any. */
export function releaseConversationSubscription(
  ref: SubscribedConversationRef,
  service: ConversationUnsubscriber,
): void {
  const previous = ref.current;
  ref.current = null;
  if (previous) service.unsubscribeFromConversation(previous);
}

/**
 * Closes the previously subscribed conversation's channel, then opens `nextId`'s
 * through `subscribe` and records it as the one that is open.
 */
export function switchConversationSubscription<T>(
  ref: SubscribedConversationRef,
  nextId: string,
  service: ConversationUnsubscriber,
  subscribe: (conversationId: string) => T,
): T {
  releaseConversationSubscription(ref, service);
  const channel = subscribe(nextId);
  ref.current = nextId;
  return channel;
}

/**
 * Issue #4114 Wave 6: a brand channel listens to all of its event chats on ONE
 * realtime channel. Its key is the sorted ids joined by commas (one id is just
 * that id, so ordinary chats keep their old channel name).
 */
export function conversationChannelKey(ids: string | readonly string[]): string {
  const list = typeof ids === 'string' ? [ids] : Array.from(new Set(ids)).sort();
  return list.join(',');
}

/** The postgres_changes filter for one conversation or several (`in.(…)`). */
export function conversationRealtimeFilter(ids: string | readonly string[]): string {
  const list = typeof ids === 'string' ? [ids] : Array.from(new Set(ids)).sort();
  return list.length === 1 ? `conversation_id=eq.${list[0]}` : `conversation_id=in.(${list.join(',')})`;
}
