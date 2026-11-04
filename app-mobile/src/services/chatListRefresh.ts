/**
 * #4265 — the Chats tab list is ONE React Query entry (chatListKeys.list) that
 * stays fresh for minutes. A conversation created, joined or left OUTSIDE the
 * Chats tab (a DM started from an event guest list, a session group chat, an
 * accepted / created / left collaboration session) marks it stale here, so the
 * next Chats visit shows the change instead of a list up to five minutes old.
 *
 * Same wiring as brandContactClaim: the app's one QueryClient, imported lazily
 * so this module stays light for services and the Deno lane.
 */
import { chatListKeys } from '../hooks/queryKeys';

export interface ChatListInvalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;
}

/** Marks every cached Chats list stale (refetches it now when Chats is on screen). */
export async function invalidateChatListWith(queryClient: ChatListInvalidator): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: chatListKeys.all });
}

/** For code with no QueryClient in hand (services, non-component hooks). */
export function refreshChatListAfterConversationChange(): void {
  void import('../config/queryClient')
    .then(({ queryClient }) => invalidateChatListWith(queryClient))
    .catch((error: unknown) => {
      console.warn('[chatList] could not mark the Chats list stale', error);
    });
}
