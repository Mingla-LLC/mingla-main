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
