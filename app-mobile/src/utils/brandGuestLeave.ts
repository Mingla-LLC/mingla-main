/**
 * #4459: a successful Guest chat leave (any path: the Chats row, the info
 * sheet) is announced here, so the Chats page can invalidate that brand's
 * booking status (chatKeys.brandGuestStatus) at once. Without it the booking
 * card kept "Open guest chat" for up to its 30 s staleTime and opened an
 * empty thread. Pure, so it runs under Deno.
 */
type Listener = (conversationId: string) => void;

const listeners = new Set<Listener>();

export function announceBrandGuestLeft(conversationId: string): void {
  listeners.forEach((listener) => listener(conversationId));
}

export function onBrandGuestLeft(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
